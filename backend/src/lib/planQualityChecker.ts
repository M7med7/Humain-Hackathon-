import type { GeneratedSchedule } from '../services/aiManager';

export interface QualityIssue {
  id: string;
  severity: 'high' | 'medium' | 'low';
  category: 'timeline' | 'workload' | 'dependencies' | 'completeness' | 'quality';
  title: string;
  description: string;
  suggestion: string;
  affectedTasks?: string[];
}

export interface QualityReport {
  score: number;
  level: 'excellent' | 'good' | 'fair' | 'poor';
  issues: QualityIssue[];
  passedChecks: string[];
}

const DEDUCTIONS: Record<QualityIssue['severity'], number> = { high: 15, medium: 8, low: 4 };

const TEST_PATTERNS    = [/\btest/i, /\bqa\b/i, /quality assurance/i, /unit.?test/i, /e2e/i, /integration.?test/i];
const DEPLOY_PATTERNS  = [/deploy/i, /release/i, /\bship\b/i, /\blaunch\b/i, /go.?live/i, /production setup/i, /go to production/i];
const RISK_PATTERNS    = [/\brisk/i, /contingency/i, /mitigation/i, /\bbuffer\b/i, /fallback/i];
const DESIGN_PATTERNS  = [/\bdesign\b/i, /\bui\b/i, /\bux\b/i, /mockup/i, /wireframe/i, /prototype/i, /figma/i];
const DB_PATTERNS      = [/database/i, /\bdb\b/i, /\bschema\b/i, /migration/i, /data.?model/i, /\borm\b/i];
const PLAN_PATTERNS    = [/planning/i, /kickoff/i, /requirement/i, /discovery/i, /briefing/i, /\bscope\b/i, /\banalysis\b/i];
const DEV_PATTERNS     = [/develop/i, /implement/i, /\bbuild\b/i, /\bcreate\b/i, /\bcode\b/i, /\bintegrate\b/i];

const VAGUE_PATTERNS = [
  /^setup$/i, /^implement$/i, /^fix$/i, /^update$/i, /^misc$/i, /^other$/i,
  /^implement feature$/i, /^add feature$/i, /^feature implementation$/i,
  /^backend work$/i, /^frontend work$/i, /^work on /i, /^handle /i,
  /^basic \w+$/i, /^do \w+$/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function tasksMatching(tasks: GeneratedSchedule['tasks'], patterns: RegExp[]) {
  return tasks.filter((t) => matchesAny(t.title, patterns));
}

export function checkPlanQuality(
  schedule: GeneratedSchedule,
  totalDays: number,
  memberCount: number,
): QualityReport {
  const issues: QualityIssue[] = [];
  const passedChecks: string[] = [];
  const { tasks, dependencies = [] } = schedule;

  if (tasks.length === 0) {
    return { score: 0, level: 'poor', issues: [], passedChecks: [] };
  }

  // ── 1. Missing testing tasks ──────────────────────────────────────────────
  const testTasks = tasksMatching(tasks, TEST_PATTERNS);
  if (testTasks.length === 0) {
    issues.push({
      id: 'missing-testing',
      severity: 'high',
      category: 'completeness',
      title: 'No testing tasks found',
      description: 'The plan has no tasks for testing. Shipping without tests increases the risk of defects reaching users.',
      suggestion: 'Add tasks for unit testing, integration testing, or QA review before deployment.',
    });
  } else {
    passedChecks.push('Testing tasks included');
  }

  // ── 2. Missing deployment tasks ───────────────────────────────────────────
  const deployTasks = tasksMatching(tasks, DEPLOY_PATTERNS);
  if (deployTasks.length === 0) {
    issues.push({
      id: 'missing-deployment',
      severity: 'high',
      category: 'completeness',
      title: 'No deployment or launch tasks found',
      description: "The plan doesn't include any deployment, release, or go-live tasks.",
      suggestion: 'Add a deployment task covering environment setup, CI/CD configuration, or release steps.',
    });
  } else {
    passedChecks.push('Deployment tasks included');
  }

  // ── 3. Missing planning phase ─────────────────────────────────────────────
  if (!tasksMatching(tasks, PLAN_PATTERNS).length) {
    issues.push({
      id: 'missing-planning',
      severity: 'medium',
      category: 'completeness',
      title: 'No planning or requirements phase',
      description: 'Starting development without a planning phase can lead to scope creep and unclear goals.',
      suggestion: 'Add a kickoff, requirements gathering, or discovery task at the beginning.',
    });
  } else {
    passedChecks.push('Planning phase present');
  }

  // ── 4. Missing risk items ─────────────────────────────────────────────────
  if (tasks.length > 6 && !tasksMatching(tasks, RISK_PATTERNS).length) {
    issues.push({
      id: 'missing-risk',
      severity: 'low',
      category: 'completeness',
      title: 'No risk management tasks',
      description: 'The plan has no tasks for identifying or mitigating project risks.',
      suggestion: 'Add a risk assessment task early in the project to identify potential blockers.',
    });
  }

  // ── 5. Missing UI/UX tasks (when project seems UI-heavy) ──────────────────
  const hasUiTech = schedule.technology_recommendations?.some((t) =>
    /react|vue|angular|svelte|figma|tailwind|css|html|frontend/i.test(t.tech_name),
  );
  if (hasUiTech && !tasksMatching(tasks, DESIGN_PATTERNS).length) {
    issues.push({
      id: 'missing-design',
      severity: 'medium',
      category: 'completeness',
      title: 'No UI/UX design tasks',
      description: 'The project uses frontend technologies but has no design or UX tasks.',
      suggestion: 'Add tasks for wireframes, UI design, or UX review to avoid building the wrong interfaces.',
    });
  }

  // ── 6. Missing database tasks (when project seems data-heavy) ─────────────
  const hasDbTech = schedule.technology_recommendations?.some((t) =>
    /postgres|mysql|mongo|supabase|prisma|sqlite|redis|dynamo/i.test(t.tech_name),
  );
  if (hasDbTech && !tasksMatching(tasks, DB_PATTERNS).length) {
    issues.push({
      id: 'missing-database',
      severity: 'medium',
      category: 'completeness',
      title: 'No database or schema tasks',
      description: 'The project uses a database technology but has no schema design or migration tasks.',
      suggestion: 'Add a database schema design or migration task before building data-dependent features.',
    });
  }

  // ── 7. Unrealistic timeline ───────────────────────────────────────────────
  const totalEffort = tasks.reduce((sum, t) => sum + (Number(t.estimated_days) || 1), 0);
  const availablePersonDays = totalDays * Math.max(memberCount, 1);

  if (totalEffort > availablePersonDays * 1.15) {
    const overBy = Math.round(totalEffort - availablePersonDays);
    issues.push({
      id: 'timeline-overloaded',
      severity: 'high',
      category: 'timeline',
      title: 'Timeline appears unrealistic',
      description: `Total task effort (${totalEffort} person-days) exceeds what ${memberCount} team member(s) can complete in ${totalDays} days by ${overBy} days.`,
      suggestion: 'Reduce scope, shorten individual task estimates, or parallelize more work across team members.',
    });
  } else if (totalEffort < totalDays * 0.4 && tasks.length > 3) {
    issues.push({
      id: 'timeline-underplanned',
      severity: 'low',
      category: 'timeline',
      title: 'Plan may be missing phases',
      description: `Tasks only account for ${Math.round((totalEffort / totalDays) * 100)}% of the available duration. Important phases may be missing.`,
      suggestion: 'Review whether planning, review cycles, documentation, or testing phases are missing.',
    });
  } else {
    passedChecks.push('Timeline appears realistic');
  }

  // ── 8. Overloaded single tasks (>40% of total timeline) ───────────────────
  if (totalDays > 7) {
    const heavyTasks = tasks.filter((t) => (Number(t.estimated_days) || 1) > totalDays * 0.4);
    const [firstHeavy] = heavyTasks;
    if (firstHeavy) {
      issues.push({
        id: 'oversized-tasks',
        severity: 'medium',
        category: 'timeline',
        title: `${heavyTasks.length} task(s) are too large`,
        description: `"${firstHeavy.title}" (${firstHeavy.estimated_days} days) takes more than 40% of the total project timeline.`,
        suggestion: 'Break large tasks into smaller sub-tasks of 1–3 days each for better tracking and delivery.',
        affectedTasks: heavyTasks.map((t) => t.title),
      });
    }
  }

  // ── 9. Overloaded assignee ────────────────────────────────────────────────
  if (tasks.length > 3) {
    const tasksByPerson: Record<string, number> = {};
    let unassigned = 0;
    for (const task of tasks) {
      if (task.assigned_to) tasksByPerson[task.assigned_to] = (tasksByPerson[task.assigned_to] ?? 0) + 1;
      else unassigned++;
    }

    const overloaded = Object.entries(tasksByPerson).find(([, count]) => count > tasks.length * 0.6);
    if (overloaded) {
      const pct = Math.round((overloaded[1] / tasks.length) * 100);
      issues.push({
        id: 'workload-overload',
        severity: 'medium',
        category: 'workload',
        title: 'Uneven workload distribution',
        description: `One team member carries ${overloaded[1]} of ${tasks.length} tasks (${pct}%). This creates a bottleneck.`,
        suggestion: 'Redistribute tasks more evenly. No single person should own more than 60% of all work.',
      });
    } else {
      passedChecks.push('Workload is distributed evenly');
    }

    if (unassigned > tasks.length * 0.3) {
      issues.push({
        id: 'unassigned-tasks',
        severity: 'low',
        category: 'workload',
        title: `${unassigned} task(s) have no assignee`,
        description: `${unassigned} tasks have no owner, which makes accountability unclear.`,
        suggestion: 'Assign every task to a specific team member.',
      });
    }
  }

  // ── 10. Missing dependencies ──────────────────────────────────────────────
  if (tasks.length > 4 && dependencies.length === 0) {
    issues.push({
      id: 'no-dependencies',
      severity: 'medium',
      category: 'dependencies',
      title: 'No task dependencies defined',
      description: 'Tasks have no dependencies, meaning they could all run in parallel — unlikely for a real project.',
      suggestion: 'Add Finish-to-Start dependencies between related tasks to define the correct execution order.',
    });
  } else if (dependencies.length > 0) {
    // Check that deploy doesn't skip testing
    const testIds = new Set(testTasks.map((t) => t.id));
    const deployIds = new Set(deployTasks.map((t) => t.id));

    if (testIds.size > 0 && deployIds.size > 0) {
      const deployMissingTestDep = [...deployIds].some((did) => {
        const deps = dependencies.filter((d) => d.task_id === did).map((d) => d.depends_on_task_id);
        return deps.length === 0 || deps.every((depId) => !testIds.has(depId));
      });

      if (deployMissingTestDep) {
        issues.push({
          id: 'deploy-skips-testing',
          severity: 'high',
          category: 'dependencies',
          title: 'Deployment not linked to testing',
          description: 'Deployment tasks are not set to depend on testing tasks, risking deploying untested code.',
          suggestion: 'Add dependencies so deployment only starts after all testing tasks are complete.',
        });
      } else {
        passedChecks.push('Deployment correctly depends on testing');
      }
    }

    // Check test tasks depend on dev tasks
    const devIds = new Set(tasksMatching(tasks, DEV_PATTERNS).map((t) => t.id));
    if (devIds.size > 0 && testIds.size > 0) {
      const testTasksMissingDevDep = [...testIds].filter((tid) => {
        const deps = dependencies.filter((d) => d.task_id === tid).map((d) => d.depends_on_task_id);
        return deps.length === 0 || deps.every((depId) => !devIds.has(depId));
      });

      if (testTasksMissingDevDep.length > 0) {
        const names = tasks
          .filter((t) => testTasksMissingDevDep.includes(t.id))
          .map((t) => t.title)
          .slice(0, 2);
        issues.push({
          id: 'test-missing-dev-dep',
          severity: 'medium',
          category: 'dependencies',
          title: 'Testing tasks may run before development',
          description: `${testTasksMissingDevDep.length} testing task(s) don't depend on development tasks.`,
          suggestion: 'Link each testing task to the implementation tasks it verifies.',
          affectedTasks: names,
        });
      } else {
        passedChecks.push('Testing tasks correctly depend on development');
      }
    }
  }

  // ── Vague task names ──────────────────────────────────────────────────────
  const vagueTasks = tasks.filter(
    (t) => VAGUE_PATTERNS.some((p) => p.test(t.title.trim())) || t.title.split(' ').length <= 2,
  );
  if (vagueTasks.length > 0) {
    const examples = vagueTasks
      .slice(0, 2)
      .map((t) => `"${t.title}"`)
      .join(', ');
    issues.push({
      id: 'vague-task-names',
      severity: 'medium',
      category: 'quality',
      title: `${vagueTasks.length} task(s) have vague names`,
      description: `Tasks like ${examples} lack enough specificity to be actionable.`,
      suggestion: 'Use outcome-focused names. Instead of "Setup", write "Configure CI/CD pipeline and environment variables".',
      affectedTasks: vagueTasks.map((t) => t.title),
    });
  } else {
    passedChecks.push('Task names are specific and clear');
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  const raw = issues.reduce((score, i) => score - DEDUCTIONS[i.severity], 100);
  const score = Math.max(0, Math.min(100, raw));
  const level: QualityReport['level'] =
    score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';

  return { score, level, issues, passedChecks };
}
