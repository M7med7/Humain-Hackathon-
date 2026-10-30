import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../lib/supabase';
import { isConnectivityError, withTimeout } from '../lib/timeout';
import {
  generateSchedule,
  generateImprovedSchedule,
  generateRefinedSchedule,
  generateChatResponse,
  durationToDays,
  type GeneratedSchedule,
  type ConversationTurn,
} from '../services/aiManager';
import { wouldCreateCycle, type TaskDependencyRow } from '../lib/taskDependencies';
import { resolveTemplate } from './templates';
import { checkPlanQuality, type QualityIssue } from '../lib/planQualityChecker';
import { computeRecommendations, type MemberProfile } from '../lib/assignmentEngine';

const router = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ── Shared helpers ────────────────────────────────────────────────────────────

interface MemberData {
  skills: string[];
  experience_summary: string;
  full_name: string;
  activeDays: number;
}

function normalizeChecklistItems(items: unknown): Array<{ id: string; text: string; checked: boolean }> {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { id: uuidv4(), text, checked: false } : null;
      }
      if (item && typeof item === 'object') {
        const raw = item as { id?: unknown; text?: unknown; checked?: unknown };
        const text = typeof raw.text === 'string' ? raw.text.trim() : '';
        return text
          ? { id: typeof raw.id === 'string' ? raw.id : uuidv4(), text, checked: Boolean(raw.checked) }
          : null;
      }
      return null;
    })
    .filter((item): item is { id: string; text: string; checked: boolean } => item !== null);
}

async function fetchMemberData(databaseMembers: string[]): Promise<Record<string, MemberData>> {
  const memberDataMap: Record<string, MemberData> = {};
  if (databaseMembers.length === 0) return memberDataMap;
  try {
    const [{ data }, { data: activeTasks }] = await Promise.all([
      withTimeout(
        supabase
          .from('users')
          .select('id, skills, experience_summary, full_name')
          .in('id', databaseMembers),
        4_000,
      ),
      withTimeout(
        supabase
          .from('tasks')
          .select('assigned_to, estimated_days')
          .in('assigned_to', databaseMembers)
          .neq('status', 'Done'),
        4_000,
      ),
    ]);
    const activeDaysByUser = new Map<string, number>();
    for (const task of activeTasks ?? []) {
      if (!task.assigned_to) continue;
      activeDaysByUser.set(
        task.assigned_to,
        (activeDaysByUser.get(task.assigned_to) ?? 0) + (Number(task.estimated_days) || 0),
      );
    }
    if (data) {
      for (const user of data) {
        memberDataMap[user.id] = {
          skills: user.skills ?? [],
          experience_summary: user.experience_summary ?? '',
          full_name: user.full_name ?? user.id,
          activeDays: activeDaysByUser.get(user.id) ?? 0,
        };
      }
    }
  } catch (err) {
    console.error('[AI] fetchMemberData failed:', err);
  }
  return memberDataMap;
}

async function estimateHistoryHint(): Promise<string> {
  try {
    const { data } = await withTimeout(
      supabase
        .from('tasks')
        .select('estimated_days, time_entries(minutes)')
        .eq('status', 'Done')
        .limit(80),
      4_000,
    );
    const ratios: number[] = [];
    for (const task of data ?? []) {
      const actualMinutes = ((task as any).time_entries ?? []).reduce((sum: number, entry: any) => sum + Number(entry.minutes || 0), 0);
      const estimatedMinutes = Number(task.estimated_days || 0) * 8 * 60;
      if (actualMinutes > 0 && estimatedMinutes > 0) ratios.push(actualMinutes / estimatedMinutes);
    }
    if (ratios.length < 3) return '';
    const avg = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
    const percent = Math.round(avg * 100);
    return `\n\nHistorical planning data: completed tasks with time tracking averaged ${percent}% of the original estimated effort. Use this as a calibration signal when choosing estimated_days; do not overfit a single task.`;
  } catch {
    return '';
  }
}

function buildMemberProfiles(databaseMembers: string[], memberDataMap: Record<string, MemberData>): MemberProfile[] {
  return databaseMembers
    .map((userId) => {
      const d = memberDataMap[userId];
      if (!d) return null;
      return { userId, fullName: d.full_name, skills: d.skills, experienceSummary: d.experience_summary, activeDays: d.activeDays };
    })
    .filter((p): p is MemberProfile => p !== null);
}

function parseDuration(duration: unknown, duration_unit: unknown) {
  const durationValue = Math.max(1, parseInt(String(duration)) || 8);
  const validUnits = ['Weeks', 'Months', 'Years'] as const;
  const durationUnit = validUnits.includes(duration_unit as any)
    ? (duration_unit as (typeof validUnits)[number])
    : 'Weeks';
  const totalDays = durationToDays(durationValue, durationUnit);
  const durationWeeks = Math.max(1, Math.round(totalDays / 7));
  return { durationValue, durationUnit, totalDays, durationWeeks };
}

async function persistPlan(
  projectId: string,
  name: string,
  savedDescription: string,
  durationWeeks: number,
  databaseMembers: string[],
  schedule: GeneratedSchedule,
  owner: { spaceId: string; userId: string },
) {
  const projectTable = supabase.from('projects') as any;
  let project = { id: projectId, name, description: savedDescription };

  const { data, error: projectError } = await withTimeout<{ data: any; error: any }>(
    projectTable
      .insert({ id: projectId, name, description: savedDescription, created_by: owner.userId, space_id: owner.spaceId, duration_weeks: durationWeeks })
      .select()
      .single(),
  );
  if (projectError) throw projectError;
  project = data ?? project;

  if (databaseMembers.length > 0) {
    await withTimeout(
      supabase.from('team_assignments').insert(
        databaseMembers.map((user_id) => ({ project_id: project.id, user_id, role: 'Member' })),
      ),
    );
  }

  if (schedule.tasks.length > 0) {
    const taskIdMap = new Map<string, string>();
    const tasksToInsert = schedule.tasks.map((task) => {
      const generatedId = String(task.id || uuidv4());
      const savedId = UUID_PATTERN.test(generatedId) ? generatedId : uuidv4();
      taskIdMap.set(generatedId, savedId);
      return {
        id: savedId,
        project_id: project.id,
        title: task.title,
        description: task.description ?? '',
        status: 'To Do',
        priority: ['High', 'Medium', 'Low'].includes((task as any).priority)
          ? (task as any).priority
          : 'Medium',
        estimated_days: Number(task.estimated_days) || 1,
        assigned_tech: Array.isArray(task.assigned_tech) ? task.assigned_tech : [],
        assigned_to: databaseMembers.includes(task.assigned_to) ? task.assigned_to : null,
        acceptance_criteria: normalizeChecklistItems(task.acceptance_criteria),
        definition_of_done: normalizeChecklistItems(task.definition_of_done),
      };
    });

    const { error: taskError } = await withTimeout(
      supabase.from('tasks').insert(tasksToInsert),
      10_000,
    );
    if (taskError) throw taskError;
    console.log(`[AI] persistPlan — inserted ${tasksToInsert.length} tasks`);

    const insertedTaskIds = new Set(tasksToInsert.map((t) => t.id));
    const dependencyRows: TaskDependencyRow[] = [];
    for (const dep of schedule.dependencies ?? []) {
      const taskId = taskIdMap.get(String(dep.task_id)) ?? dep.task_id;
      const dependsOnTaskId = taskIdMap.get(String(dep.depends_on_task_id)) ?? dep.depends_on_task_id;
      if (
        !insertedTaskIds.has(taskId) ||
        !insertedTaskIds.has(dependsOnTaskId) ||
        taskId === dependsOnTaskId
      ) continue;
      if (dependencyRows.some((r) => r.task_id === taskId && r.depends_on_task_id === dependsOnTaskId)) continue;
      if (wouldCreateCycle(taskId, dependsOnTaskId, dependencyRows)) continue;
      dependencyRows.push({ task_id: taskId, depends_on_task_id: dependsOnTaskId });
    }

    if (dependencyRows.length > 0) {
      const { error: depError } = await withTimeout(
        supabase.from('task_dependencies').insert(
          dependencyRows.map((dep) => ({ ...dep, dependency_type: 'Finish-to-Start' })),
        ),
        10_000,
      );
      if (depError) throw depError;
      console.log(`[AI] persistPlan — inserted ${dependencyRows.length} dependencies`);
    }
  }

  return project;
}

// ── POST /generate — generate plan + quality check, NO DB write ───────────────

router.post('/generate', async (req, res) => {
  const t0 = Date.now();
  const generationController = new AbortController();
  const abortGeneration = () => {
    if (!res.writableEnded) generationController.abort();
  };
  res.once('close', abortGeneration);
  let streamingResponse = false;
  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    if (!streamingResponse) {
      res.status(200);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      streamingResponse = true;
    }
    // JSON permits leading whitespace. Sending it periodically keeps hosting proxies
    // from treating AI generation as an idle request while preserving a JSON response.
    res.write(' \n');
  }, 10_000);

  try {
    const {
      name, description, headcount, duration, duration_unit,
      team_members, expand_description, template_id,
      complexity, budget, deadline_strictness, preferred_tech, excluded_tech,
    } = req.body;

    if (!name || !description) {
      return res.status(400).json({ error: 'name and description are required' });
    }

    console.log(`[AI] /generate received — name="${name}" duration="${duration} ${duration_unit}"`);

    const projectId = uuidv4();
    const headcountNum = parseInt(headcount) || 1;
    const selectedMembers: string[] = Array.isArray(team_members)
      ? team_members.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
      : [];
    const databaseMembers = selectedMembers.filter((u) => UUID_PATTERN.test(u));

    const [memberDataMap, historyHint, template] = await Promise.all([
      fetchMemberData(databaseMembers),
      estimateHistoryHint(),
      resolveTemplate(template_id),
    ]);

    const scheduleMembers =
      selectedMembers.length > 0
        ? selectedMembers.map((user_id) => {
            const entry: { user_id: string; skills?: string[]; experience_summary?: string } = { user_id };
            const data = memberDataMap[user_id];
            if (data?.skills) entry.skills = data.skills;
            if (data?.experience_summary) entry.experience_summary = data.experience_summary;
            return entry;
          })
        : Array.from({ length: headcountNum }, (_, i) => ({ user_id: `user${i + 1}` }));

    const { durationValue, durationUnit, totalDays, durationWeeks } = parseDuration(duration, duration_unit);

    const scheduleReq = {
      projectId,
      projectName: name,
      description: `${description}${historyHint}`,
      durationValue,
      durationUnit,
      teamMembers: scheduleMembers,
      template,
      signal: generationController.signal,
      ...(complexity && { complexity: complexity as 'simple' | 'standard' | 'advanced' }),
      ...(budget !== undefined && !isNaN(Number(budget)) && { budget: Number(budget) }),
      ...(deadline_strictness && { deadlineStrictness: deadline_strictness as 'flexible' | 'fixed' }),
      ...(Array.isArray(preferred_tech) && preferred_tech.length > 0 && { preferredTech: preferred_tech as string[] }),
      ...(Array.isArray(excluded_tech) && excluded_tech.length > 0 && { excludedTech: excluded_tech as string[] }),
    };
    const schedule = await generateSchedule(scheduleReq);

    const savedDescription =
      expand_description === false ? description : (schedule.project_summary || description);

    const qualityReport = checkPlanQuality(schedule, totalDays, Math.max(scheduleMembers.length, 1));
    const memberProfiles = buildMemberProfiles(databaseMembers, memberDataMap);
    const recommendations = computeRecommendations(schedule, memberProfiles);

    console.log(`[AI] /generate complete in ${Date.now() - t0}ms — quality score ${qualityReport.score}`);

    const responseBody = {
      success: true,
      projectId,
      schedule,
      qualityReport,
      savedDescription,
      durationWeeks,
      databaseMembers,
      totalDays,
      recommendations,
    };
    if (streamingResponse) res.end(JSON.stringify(responseBody));
    else res.json(responseBody);
  } catch (error: any) {
    console.error(`[AI] /generate error after ${Date.now() - t0}ms:`, error.message);
    if (res.destroyed) return;
    if (isConnectivityError(error)) {
      const responseBody = {
        success: true,
        project_id: uuidv4(),
        offline: true,
        message: 'Generated in demo mode because Supabase is not reachable.',
      };
      if (streamingResponse) return res.end(JSON.stringify(responseBody));
      return res.json(responseBody);
    }
    const responseBody = { error: error.message };
    if (streamingResponse) return res.end(JSON.stringify(responseBody));
    res.status(500).json(responseBody);
  } finally {
    clearInterval(heartbeat);
    res.off('close', abortGeneration);
  }
});

// ── POST /save — persist a previewed plan to DB ───────────────────────────────

router.post('/save', async (req, res) => {
  const t0 = Date.now();
  try {
    const { projectId, schedule, name, savedDescription, durationWeeks, databaseMembers } = req.body;

    if (!projectId || !schedule || !name) {
      return res.status(400).json({ error: 'projectId, schedule, and name are required' });
    }

    console.log(`[AI] /save received — projectId="${projectId}" tasks=${schedule.tasks?.length}`);

    const project = await persistPlan(
      projectId,
      name,
      savedDescription ?? '',
      durationWeeks ?? 1,
      Array.isArray(databaseMembers) ? databaseMembers : [],
      schedule as GeneratedSchedule,
      { spaceId: res.locals.spaceId as string, userId: res.locals.userId as string },
    );

    console.log(`[AI] /save complete in ${Date.now() - t0}ms`);
    res.json({ success: true, project_id: project.id });
  } catch (error: any) {
    console.error(`[AI] /save error after ${Date.now() - t0}ms:`, error.message);
    if (isConnectivityError(error)) {
      return res.json({ success: true, project_id: req.body.projectId, offline: true });
    }
    res.status(500).json({ error: error.message });
  }
});

// ── POST /improve — regenerate plan addressing quality issues ─────────────────

router.post('/improve', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      currentSchedule, issues, name, description,
      duration, duration_unit, team_members, databaseMembers: dbMembersFromClient,
      totalDays: totalDaysFromClient,
    } = req.body;

    if (!currentSchedule || !name || !description) {
      return res.status(400).json({ error: 'currentSchedule, name, and description are required' });
    }

    console.log(`[AI] /improve received — ${issues?.length ?? 0} issues`);

    const selectedMembers: string[] = Array.isArray(team_members)
      ? team_members.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
      : [];
    const databaseMembers: string[] = Array.isArray(dbMembersFromClient)
      ? dbMembersFromClient
      : selectedMembers.filter((u) => UUID_PATTERN.test(u));

    const memberDataMap = await fetchMemberData(databaseMembers);

    const scheduleMembers =
      selectedMembers.length > 0
        ? selectedMembers.map((user_id) => {
            const entry: { user_id: string; skills?: string[]; experience_summary?: string } = { user_id };
            const data = memberDataMap[user_id];
            if (data?.skills) entry.skills = data.skills;
            if (data?.experience_summary) entry.experience_summary = data.experience_summary;
            return entry;
          })
        : [{ user_id: 'user1' }];

    const { durationValue, durationUnit, totalDays, durationWeeks } = parseDuration(duration, duration_unit);
    const effectiveTotalDays = totalDaysFromClient ?? totalDays;

    const issueSummary = (issues as QualityIssue[])
      .map((i) => `[${i.severity.toUpperCase()}] ${i.title}: ${i.description} → Fix: ${i.suggestion}`)
      .join('\n');

    const projectId = uuidv4();
    const improvedSchedule = await generateImprovedSchedule(
      {
        projectId,
        projectName: name,
        description,
        durationValue,
        durationUnit,
        teamMembers: scheduleMembers,
        template: null,
      },
      currentSchedule as GeneratedSchedule,
      issueSummary,
    );

    const qualityReport = checkPlanQuality(
      improvedSchedule,
      effectiveTotalDays,
      Math.max(scheduleMembers.length, 1),
    );
    const memberProfiles = buildMemberProfiles(databaseMembers, memberDataMap);
    const recommendations = computeRecommendations(improvedSchedule, memberProfiles);

    const savedDescription = improvedSchedule.project_summary || description;

    console.log(`[AI] /improve complete in ${Date.now() - t0}ms — new score ${qualityReport.score}`);

    res.json({
      success: true,
      projectId,
      schedule: improvedSchedule,
      qualityReport,
      savedDescription,
      durationWeeks,
      databaseMembers,
      totalDays: effectiveTotalDays,
      recommendations,
    });
  } catch (error: any) {
    console.error(`[AI] /improve error after ${Date.now() - t0}ms:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /refine — natural-language plan refinement with ID-preserving diff ───

router.post('/refine', async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      currentSchedule, userMessage, conversationHistory,
      name, description, duration, duration_unit, team_members,
      databaseMembers: dbMembersFromClient, totalDays: totalDaysFromClient,
    } = req.body;

    if (!currentSchedule || !userMessage?.trim() || !name) {
      return res.status(400).json({ error: 'currentSchedule, userMessage, and name are required' });
    }

    console.log(`[AI] /refine — "${String(userMessage).slice(0, 80)}"`);

    const selectedMembers: string[] = Array.isArray(team_members)
      ? team_members.filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
      : [];
    const databaseMembers: string[] = Array.isArray(dbMembersFromClient)
      ? dbMembersFromClient
      : selectedMembers.filter((u) => UUID_PATTERN.test(u));

    const memberDataMap = await fetchMemberData(databaseMembers);

    // Fetch full_name for name-based assignment instructions
    let memberNames: Array<{ user_id: string; full_name: string }> = [];
    if (databaseMembers.length > 0) {
      try {
        const { data } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', databaseMembers);
        if (data) memberNames = data.map((u) => ({ user_id: u.id, full_name: u.full_name ?? u.id }));
      } catch { /* non-critical */ }
    }

    const scheduleMembers =
      selectedMembers.length > 0
        ? selectedMembers.map((user_id) => {
            const entry: { user_id: string; skills?: string[]; experience_summary?: string } = { user_id };
            const data = memberDataMap[user_id];
            if (data?.skills) entry.skills = data.skills;
            if (data?.experience_summary) entry.experience_summary = data.experience_summary;
            return entry;
          })
        : [{ user_id: 'user1' }];

    const { durationValue, durationUnit, totalDays, durationWeeks } = parseDuration(duration, duration_unit);
    const effectiveTotalDays = (totalDaysFromClient as number | undefined) ?? totalDays;

    const projectId = uuidv4();
    const { schedule: refinedSchedule, refinementSummary } = await generateRefinedSchedule(
      { projectId, projectName: name, description, durationValue, durationUnit, teamMembers: scheduleMembers, template: null },
      currentSchedule as GeneratedSchedule,
      String(userMessage),
      Array.isArray(conversationHistory)
        ? (conversationHistory as ConversationTurn[]).slice(-10)  // last 10 turns for context window
        : [],
      memberNames,
    );

    const qualityReport = checkPlanQuality(
      refinedSchedule,
      effectiveTotalDays,
      Math.max(scheduleMembers.length, 1),
    );
    const memberProfiles = buildMemberProfiles(databaseMembers, memberDataMap);
    const recommendations = computeRecommendations(refinedSchedule, memberProfiles);

    console.log(`[AI] /refine complete in ${Date.now() - t0}ms — ${refinementSummary}`);

    res.json({
      success: true,
      projectId,
      schedule: refinedSchedule,
      qualityReport,
      savedDescription: refinedSchedule.project_summary || description,
      durationWeeks,
      databaseMembers,
      totalDays: effectiveTotalDays,
      refinementSummary,
      recommendations,
    });
  } catch (error: any) {
    console.error(`[AI] /refine error after ${Date.now() - t0}ms:`, error.message);
    res.status(500).json({ error: error.message });
  }
});

// ── POST /chat ────────────────────────────────────────────────────────────────

router.post('/chat', async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  try {
    const response = await generateChatResponse(message as string, context as string | undefined);
    res.json({ response });
  } catch (err: any) {
    console.error('[AI] /chat error:', err.message);
    res.status(500).json({ response: 'AI service error. Please try again.' });
  }
});

export default router;
