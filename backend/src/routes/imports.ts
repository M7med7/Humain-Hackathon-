import { Router } from 'express';
import { randomUUID } from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';

const router = Router();

// ── CSV helpers ────────────────────────────────────────────────────────────────

function csvEscape(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvEscape).join(',');
}

/** Minimal RFC-4180 CSV parser — handles quoted fields with embedded commas/newlines */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      if (text[i] === '"') {
        // quoted field
        i++;
        let field = '';
        while (i < len) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            field += text[i++];
          }
        }
        row.push(field);
      } else {
        // unquoted field
        let field = '';
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          field += text[i++];
        }
        row.push(field.trim());
      }
      if (i < len && text[i] === ',') { i++; continue; }
      break;
    }
    // skip CRLF / LF
    if (i < len && text[i] === '\r') i++;
    if (i < len && text[i] === '\n') i++;
    if (row.length > 0) rows.push(row);
  }
  return rows;
}

function csvToObjects(text: string): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0]!.map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? ''; });
    return obj;
  });
}

// ── Field mappers ──────────────────────────────────────────────────────────────

const JIRA_PRIORITY_MAP: Record<string, string> = {
  highest: 'High', high: 'High', medium: 'Medium', low: 'Low', lowest: 'Low',
};

const LINEAR_PRIORITY_MAP: Record<string, string> = {
  'no priority': 'Low', urgent: 'High', high: 'High', medium: 'Medium', low: 'Low',
};

const STATUS_MAP: Record<string, string> = {
  // Jira defaults
  'to do': 'To Do', 'in progress': 'In Progress', 'in review': 'In Review',
  done: 'Done', backlog: 'Backlog', closed: 'Done', resolved: 'Done', open: 'To Do',
  // Linear defaults
  todo: 'To Do', started: 'In Progress', completed: 'Done', cancelled: 'Done',
  triage: 'Backlog',
};

function normalizeStatus(raw: string): string {
  return STATUS_MAP[raw.toLowerCase()] ?? 'Backlog';
}

function normalizePriority(raw: string, source: 'jira' | 'linear'): string {
  const map = source === 'jira' ? JIRA_PRIORITY_MAP : LINEAR_PRIORITY_MAP;
  return map[raw.toLowerCase()] ?? 'Medium';
}

function parseEstimate(raw: string): number {
  const n = parseFloat(raw);
  return isNaN(n) || n <= 0 ? 1 : Math.max(1, Math.round(n));
}

function parseDate(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  const iso = d.toISOString().split('T')[0];
  return isNaN(d.getTime()) ? null : (iso ?? null);
}

function parseLabels(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/[,;|\s]+/).map((l) => l.trim()).filter(Boolean);
}

// ── Import preview types ───────────────────────────────────────────────────────

export interface ImportRow {
  external_id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  estimated_days: number;
  start_date: string | null;
  end_date: string | null;
  labels: string[];
  assigned_tech: string[];
  acceptance_criteria: Array<{ id: string; text: string; checked: boolean }>;
}

// ── Jira CSV column names ──────────────────────────────────────────────────────
// Jira exports use "Summary", "Description", "Issue key", "Priority", "Status",
// "Assignee", "Due Date", "Story Points", "Labels", "Sprint", "Acceptance Criteria"

function mapJiraRow(row: Record<string, string>): ImportRow {
  const title = row['Summary'] || row['summary'] || row['Title'] || '';
  const desc = row['Description'] || row['description'] || '';
  const priority = normalizePriority(row['Priority'] || row['priority'] || 'Medium', 'jira');
  const status = normalizeStatus(row['Status'] || row['status'] || '');
  const storyPoints = row['Story Points'] || row['Story points'] || row['story_points'] || '';
  const estimated = parseEstimate(storyPoints || '1');
  const dueDate = parseDate(row['Due Date'] || row['due_date'] || row['Due date'] || '');
  const labels = parseLabels(row['Labels'] || row['labels'] || '');
  const externalId = row['Issue key'] || row['Issue Key'] || row['id'] || row['ID'] || randomUUID();
  const acText = row['Acceptance Criteria'] || row['acceptance_criteria'] || '';

  const acceptance_criteria = acText
    ? acText.split(/\n+/).map((t) => t.trim()).filter(Boolean).map((text) => ({ id: randomUUID(), text, checked: false }))
    : [];

  const implSteps = row['Implementation Steps'] || row['implementation_steps'] || '';
  const description = [desc, implSteps].filter(Boolean).join('\n\n');

  return { external_id: externalId, title, description, priority, status, estimated_days: estimated, start_date: null, end_date: dueDate, labels, assigned_tech: [], acceptance_criteria };
}

// ── Linear CSV column names ────────────────────────────────────────────────────
// Linear exports use "Title", "Description", "Priority", "Status", "Assignee",
// "Due Date", "Estimate", "Labels", "Identifier"

function mapLinearRow(row: Record<string, string>): ImportRow {
  const title = row['Title'] || row['title'] || row['Summary'] || '';
  const desc = row['Description'] || row['description'] || '';
  const priority = normalizePriority(row['Priority'] || row['priority'] || 'No priority', 'linear');
  const status = normalizeStatus(row['Status'] || row['status'] || '');
  const estimate = row['Estimate'] || row['estimate'] || '1';
  const estimated = parseEstimate(estimate);
  const dueDate = parseDate(row['Due Date'] || row['due_date'] || row['Due date'] || '');
  const labels = parseLabels(row['Labels'] || row['labels'] || row['Label'] || '');
  const externalId = row['Identifier'] || row['identifier'] || row['ID'] || row['id'] || randomUUID();

  return { external_id: externalId, title, description: desc, priority, status, estimated_days: estimated, start_date: null, end_date: dueDate, labels, assigned_tech: [], acceptance_criteria: [] };
}

// ── Export helpers ─────────────────────────────────────────────────────────────

function checklistText(items: Array<{ text: string; checked: boolean }> | null | undefined): string {
  if (!items?.length) return '';
  return items.map((i) => `- [${i.checked ? 'x' : ' '}] ${i.text}`).join('\n');
}

function buildJiraCsv(tasks: any[]): string {
  const headers = ['Issue key', 'Summary', 'Description', 'Priority', 'Status', 'Assignee email', 'Due Date', 'Story Points', 'Labels', 'Acceptance Criteria', 'Implementation Steps'];
  const rows = tasks.map((t) => {
    const ac = checklistText(t.acceptance_criteria);
    const dod = checklistText(t.definition_of_done);
    return csvRow([
      t.external_id ?? t.id,
      t.title,
      t.description ?? '',
      t.priority,
      t.status,
      t.assignee_email ?? '',
      t.end_date ?? '',
      String(t.estimated_days),
      (t.labels ?? []).join(', '),
      ac,
      dod,
    ]);
  });
  return [csvRow(headers), ...rows].join('\r\n');
}

function buildLinearCsv(tasks: any[]): string {
  const headers = ['Identifier', 'Title', 'Description', 'Priority', 'Status', 'Assignee email', 'Due Date', 'Estimate', 'Labels'];
  const LINEAR_PRIORITY: Record<string, string> = { High: 'High', Medium: 'Medium', Low: 'Low' };
  const rows = tasks.map((t) => {
    const ac = checklistText(t.acceptance_criteria);
    const fullDesc = [t.description ?? '', ac ? `\nAcceptance Criteria:\n${ac}` : ''].filter(Boolean).join('');
    return csvRow([
      t.external_id ?? t.id,
      t.title,
      fullDesc,
      LINEAR_PRIORITY[t.priority] ?? 'No priority',
      t.status,
      t.assignee_email ?? '',
      t.end_date ?? '',
      String(t.estimated_days),
      (t.labels ?? []).join(', '),
    ]);
  });
  return [csvRow(headers), ...rows].join('\r\n');
}

// ── Routes ─────────────────────────────────────────────────────────────────────

/** GET /api/imports/projects/:projectId/export?format=jira|linear */
router.get('/projects/:projectId/export', async (req, res) => {
  try {
    const { projectId } = req.params;
    const format = (req.query.format as string ?? 'jira').toLowerCase();
    if (format !== 'jira' && format !== 'linear') {
      return res.status(400).json({ error: 'format must be "jira" or "linear"' });
    }

    const { data: tasks, error } = await withTimeout(
      supabase
        .from('tasks')
        .select('*, users!tasks_assigned_to_fkey(email)')
        .eq('project_id', projectId)
        .order('created_at'),
    );
    if (error) throw error;
    if (!tasks?.length) return res.status(404).json({ error: 'No tasks found for this project.' });

    const enriched = tasks.map((t: any) => ({ ...t, assignee_email: t.users?.email ?? '' }));
    const csv = format === 'linear' ? buildLinearCsv(enriched) : buildJiraCsv(enriched);
    const filename = `01manager-export-${format}-${projectId.slice(0, 8)}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/imports/projects/:projectId/preview
 *  Body: { source: 'jira'|'linear', csv: string }
 *  Returns mapped tasks without writing to DB
 */
router.post('/projects/:projectId/preview', async (req, res) => {
  try {
    const { source, csv } = req.body as { source?: string; csv?: string };
    if (!source || (source !== 'jira' && source !== 'linear')) {
      return res.status(400).json({ error: 'source must be "jira" or "linear"' });
    }
    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({ error: 'csv content is required' });
    }
    if (csv.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'CSV file too large (max 5 MB)' });
    }

    const objects = csvToObjects(csv);
    if (!objects.length) return res.status(400).json({ error: 'CSV has no data rows.' });

    const mapper = source === 'jira' ? mapJiraRow : mapLinearRow;
    const rows: ImportRow[] = objects
      .map(mapper)
      .filter((r) => r.title.trim().length > 0);

    if (!rows.length) return res.status(400).json({ error: 'No valid tasks found in the CSV.' });

    res.json({ source, tasks: rows, total: rows.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/imports/projects/:projectId/import
 *  Body: { source: 'jira'|'linear', tasks: ImportRow[], created_by?: string }
 *  Writes tasks to DB, skips duplicates
 */
router.post('/projects/:projectId/import', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { source, tasks, created_by } = req.body as {
      source?: string;
      tasks?: ImportRow[];
      created_by?: string | null;
    };

    if (!source || (source !== 'jira' && source !== 'linear')) {
      return res.status(400).json({ error: 'source must be "jira" or "linear"' });
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ error: 'tasks array is required and must not be empty' });
    }
    if (tasks.length > 200) {
      return res.status(400).json({ error: 'Cannot import more than 200 tasks at once.' });
    }

    // Fetch existing external IDs for this project + source to skip duplicates
    const { data: existing } = await withTimeout(
      supabase
        .from('tasks')
        .select('external_id')
        .eq('project_id', projectId)
        .eq('external_source', source),
    );
    const existingIds = new Set((existing ?? []).map((r: any) => r.external_id));

    const toInsert = tasks
      .filter((t) => t.title?.trim())
      .filter((t) => !existingIds.has(t.external_id))
      .map((t) => ({
        project_id: projectId,
        title: t.title.trim(),
        description: t.description || null,
        status: t.status,
        priority: t.priority,
        estimated_days: t.estimated_days,
        start_date: t.start_date,
        end_date: t.end_date,
        labels: t.labels ?? [],
        assigned_tech: t.assigned_tech ?? [],
        acceptance_criteria: t.acceptance_criteria ?? [],
        external_source: source,
        external_id: t.external_id,
        assigned_to: null,
      }));

    if (!toInsert.length) {
      return res.json({ imported: 0, skipped: tasks.length, tasks: [], message: 'All tasks already imported.' });
    }

    const { data: created, error } = await withTimeout(
      supabase.from('tasks').insert(toInsert).select(),
    );
    if (error) throw error;

    // Log activity for each created task
    await Promise.all(
      (created ?? []).map((t: any) =>
        withTimeout(
          supabase.from('task_activity').insert({
            task_id: t.id,
            user_id: created_by ?? null,
            activity_type: `${source}_imported`,
            summary: `Imported from ${source === 'jira' ? 'Jira' : 'Linear'}`,
            metadata: { external_id: t.external_id, source },
          }),
        ).catch(() => {}),
      ),
    );

    res.json({
      imported: created?.length ?? 0,
      skipped: tasks.length - toInsert.length,
      tasks: created ?? [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/imports/projects/:projectId/analyze
 *  Body: { task_ids: string[] }
 *  Runs AI analysis on imported tasks and returns findings
 */
router.post('/projects/:projectId/analyze', async (req, res) => {
  try {
    const { task_ids } = req.body as { task_ids?: string[] };
    if (!Array.isArray(task_ids) || task_ids.length === 0) {
      return res.status(400).json({ error: 'task_ids array is required' });
    }

    const { data: tasks, error } = await withTimeout(
      supabase
        .from('tasks')
        .select('id, title, description, priority, status, estimated_days, labels, acceptance_criteria')
        .in('id', task_ids.slice(0, 50)),
    );
    if (error) throw error;
    if (!tasks?.length) return res.status(404).json({ error: 'No tasks found.' });

    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.AI_MODEL ?? 'gemini-2.5-flash';
    if (!apiKey) return res.status(503).json({ error: 'AI analysis is not configured (missing GEMINI_API_KEY).' });

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const taskList = tasks.map((t: any, i: number) =>
      `${i + 1}. [${t.priority}] ${t.title} (${t.estimated_days}d, status: ${t.status})\n   ${t.description ? t.description.slice(0, 200) : 'No description'}`,
    ).join('\n');

    const prompt = `You are a software project analyst reviewing tasks imported into a project management tool.

Analyze the following ${tasks.length} tasks and identify:
1. Missing dependencies (tasks that likely need another task completed first)
2. Workload risks (tasks with unrealistic estimates or vague descriptions)
3. Scope gaps (important work that appears to be missing)
4. Priority conflicts (tasks that seem mis-prioritized)

Tasks:
${taskList}

Respond with a JSON object with this exact structure:
{
  "summary": "one paragraph summary",
  "risk_level": "Low|Medium|High",
  "findings": [
    {
      "type": "dependency|workload|scope_gap|priority",
      "severity": "high|medium|low",
      "title": "short title",
      "description": "detailed explanation",
      "affected_tasks": ["task title 1", "task title 2"]
    }
  ],
  "recommendations": ["recommendation 1", "recommendation 2"]
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(502).json({ error: 'AI returned an unexpected response.' });

    const analysis = JSON.parse(jsonMatch[0]);
    res.json({ analysis, task_count: tasks.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
