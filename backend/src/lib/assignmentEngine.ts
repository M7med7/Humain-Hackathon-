import type { GeneratedSchedule } from '../services/aiManager';

export interface MemberProfile {
  userId: string;
  fullName: string;
  skills: string[];
  experienceSummary: string;
  activeDays: number; // current workload: sum of estimated_days on non-completed tasks
}

export interface AssignmentRecommendation {
  userId: string;
  confidence: number;      // 0-100
  reason: string;          // short, human-readable
  skillMatches: string[];
  skillGaps: string[];
  overloadWarning?: string;
  trainingSuggestion?: string;
}

// ── Skill extraction ──────────────────────────────────────────────────────────

// Keywords that appear in task titles/descriptions that map to skills
const TECH_KEYWORDS = [
  'react native', 'github actions', 'tailwind css', 'next.js', 'node.js',
  'react', 'vue', 'angular', 'next', 'nuxt', 'svelte',
  'node', 'express', 'fastapi', 'django', 'rails', 'spring',
  'python', 'javascript', 'typescript', 'java', 'go', 'rust', 'php', 'ruby',
  'sql', 'postgres', 'postgresql', 'mysql', 'mongodb', 'redis', 'supabase', 'firebase',
  'docker', 'kubernetes', 'aws', 'azure', 'gcp', 'terraform',
  'graphql', 'rest', 'grpc', 'websocket',
  'testing', 'jest', 'cypress', 'playwright', 'pytest',
  'ci', 'cd', 'github actions', 'jenkins',
  'mobile', 'ios', 'android', 'flutter', 'react native',
  'ml', 'ai', 'openai', 'llm', 'tensorflow', 'pytorch', 'sklearn',
  'elasticsearch', 'kafka', 'rabbitmq',
  'ui', 'ux', 'figma', 'design',
  'backend', 'frontend', 'fullstack', 'devops', 'security',
];

export function extractRequiredSkills(task: { title: string; description: string | null; assigned_tech: string[] }): string[] {
  const sources = [
    task.title,
    task.description ?? '',
    ...task.assigned_tech,
  ].join(' ');

  const normalizedSource = sources.toLowerCase();
  const fromKeywords = TECH_KEYWORDS.filter((kw) => normalizedSource.includes(kw));
  const fromTech = task.assigned_tech.map((t) => t.toLowerCase().trim()).filter(Boolean);
  return [...new Set([...fromTech, ...fromKeywords])];
}

// ── Skill matching ────────────────────────────────────────────────────────────

function normalise(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function skillsOverlap(required: string[], memberSkills: string[]): { matches: string[]; gaps: string[] } {
  const normMember = memberSkills.map(normalise);
  const matches: string[] = [];
  const gaps: string[] = [];

  for (const req of required) {
    const normReq = normalise(req);
    const found = normMember.some((ms) => ms.includes(normReq) || normReq.includes(ms));
    if (found) matches.push(req);
    else gaps.push(req);
  }

  return { matches, gaps };
}

// ── Experience relevance ──────────────────────────────────────────────────────

function hasRelevantExperience(summary: string, task: { title: string; description: string | null; assigned_tech: string[] }): boolean {
  if (!summary) return false;
  const words = [
    task.title,
    task.description ?? '',
    ...task.assigned_tech,
  ].join(' ').toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  const norm = summary.toLowerCase();
  return words.some((w) => norm.includes(w));
}

// ── Reason text ───────────────────────────────────────────────────────────────

function buildReason(
  confidence: number,
  skillMatches: string[],
  skillGaps: string[],
  workloadRatio: number, // 0 = low load, 1 = max load on team
  hasRequiredSkills: boolean,
): string {
  const parts: string[] = [];

  if (!hasRequiredSkills) {
    parts.push('requirements are unclear');
  }

  if (skillMatches.length > 0) {
    parts.push(`matches ${skillMatches.slice(0, 3).join(', ')}`);
  }

  if (workloadRatio <= 0.35) {
    parts.push('low current load');
  } else if (workloadRatio >= 0.8) {
    parts.push('heavy current load');
  }

  if (skillGaps.length > 0 && skillGaps.length <= 2) {
    parts.push(`gap: ${skillGaps.join(', ')}`);
  }

  const base = parts.length > 0 ? parts.join(' · ') : 'available';

  if (!hasRequiredSkills && confidence < 40) return `Weak match — requirements are unclear · ${base}`;
  if (confidence >= 80) return `Best fit — ${base}`;
  if (confidence >= 60) return `Good match — ${base}`;
  if (confidence >= 40) return `Partial match — ${base}`;
  return `Weak match — consider help with ${skillGaps.slice(0, 2).join(', ') || 'requirements'}`;
}

// ── Core scoring ──────────────────────────────────────────────────────────────

function scoreCandidate(
  requiredSkills: string[],
  member: MemberProfile,
  maxActiveDays: number,
  task: { title: string; description: string | null; assigned_tech: string[] },
): { score: number; matches: string[]; gaps: string[]; workloadRatio: number } {
  const { matches, gaps } = skillsOverlap(requiredSkills, member.skills);

  // Skill score: up to 65 pts. No detectable requirements stays cautious.
  const skillScore =
    requiredSkills.length === 0
      ? 12
      : Math.round((matches.length / requiredSkills.length) * 65);

  // Workload score: up to 25 pts (lower load = higher score)
  const workloadRatio = maxActiveDays > 0 ? member.activeDays / maxActiveDays : 0;
  const workloadScore = Math.round((1 - Math.min(workloadRatio, 1)) * 25);

  // Experience bonus: up to 10 pts
  const expBonus = hasRelevantExperience(member.experienceSummary, task) ? 10 : 0;

  const score = Math.min(100, skillScore + workloadScore + expBonus);
  return { score, matches, gaps, workloadRatio };
}

function buildTrainingSuggestion(skillGaps: string[], confidence: number): string | undefined {
  if (skillGaps.length === 0 && confidence >= 40) return undefined;
  const target = skillGaps.slice(0, 2).join(', ') || 'the task requirements';
  return `Pair with a stronger teammate or review ${target} before starting.`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Compute assignment recommendations for every task in a schedule.
 * Returns a map keyed by task ID. Tasks with no candidate members are omitted.
 */
export function computeRecommendations(
  schedule: GeneratedSchedule,
  members: MemberProfile[],
): Record<string, AssignmentRecommendation> {
  if (members.length === 0) return {};

  const result: Record<string, AssignmentRecommendation> = {};
  const maxActiveDays = Math.max(...members.map((m) => m.activeDays), 1);

  // Overload threshold: warn when > 1.6× average
  const avgActiveDays =
    members.reduce((s, m) => s + m.activeDays, 0) / members.length;
  const overloadThreshold = avgActiveDays * 1.6;

  for (const task of schedule.tasks) {
    const required = extractRequiredSkills(task);
    let best: { score: number; member: MemberProfile; matches: string[]; gaps: string[]; workloadRatio: number } | null = null;

    for (const member of members) {
      const { score, matches, gaps, workloadRatio } = scoreCandidate(required, member, maxActiveDays, task);
      if (best === null || score > best.score) {
        best = { score, member, matches, gaps, workloadRatio };
      }
    }

    if (!best) continue;

    const overloadWarning =
      best.member.activeDays > overloadThreshold
        ? `${best.member.fullName} already has ${best.member.activeDays} days of active work`
        : undefined;

    const recommendation: AssignmentRecommendation = {
      userId: best.member.userId,
      confidence: best.score,
      reason: buildReason(best.score, best.matches, best.gaps, best.workloadRatio, required.length > 0),
      skillMatches: best.matches,
      skillGaps: best.gaps.slice(0, 4),
    };
    if (overloadWarning) recommendation.overloadWarning = overloadWarning;
    const trainingSuggestion = buildTrainingSuggestion(best.gaps, best.score);
    if (trainingSuggestion) recommendation.trainingSuggestion = trainingSuggestion;
    result[task.id] = recommendation;
  }

  return result;
}
