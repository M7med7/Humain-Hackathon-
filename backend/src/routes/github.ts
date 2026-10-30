import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { requireProjectPermission, requireTaskPermission } from '../lib/permissions';

const router = Router();

type RepoRef = { owner: string; repo: string };

function githubHeaders() {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': '01-Manager',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

function parseRepo(input: string): RepoRef | null {
  const trimmed = input.trim();
  const httpsMatch = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (httpsMatch?.[1] && httpsMatch[2]) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch?.[1] && shortMatch[2]) return { owner: shortMatch[1], repo: shortMatch[2].replace(/\.git$/, '') };
  return null;
}

async function githubJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...githubHeaders(), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.message ?? `GitHub request failed (${res.status})`;
    throw new Error(message);
  }
  return body as T;
}

async function projectRepo(projectId: string): Promise<(RepoRef & { repo_url: string; default_branch: string | null }) | null> {
  const { data, error } = await withTimeout(
    supabase.from('project_github_repositories').select('*').eq('project_id', projectId).maybeSingle(),
  );
  if (error) throw error;
  return data ? { owner: data.owner, repo: data.repo, repo_url: data.repo_url, default_branch: data.default_branch } : null;
}

async function taskProjectId(taskId: string): Promise<string> {
  const { data, error } = await withTimeout(supabase.from('tasks').select('project_id').eq('id', taskId).single());
  if (error) throw error;
  return data.project_id;
}

async function createActivity(taskId: string, userId: string | null | undefined, activityType: string, summary: string, metadata: Record<string, unknown> = {}) {
  await withTimeout(
    supabase.from('task_activity').insert({
      task_id: taskId,
      user_id: userId ?? null,
      activity_type: activityType,
      summary,
      metadata,
    }),
  ).catch((err) => console.error('[github activity] insert failed:', err.message));
}

router.get('/projects/:projectId/repository', async (req, res) => {
  try {
    const repo = await projectRepo(req.params.projectId);
    res.json({ repository: repo });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/projects/:projectId/repository', async (req, res) => {
  try {
    const { repo_url, connected_by } = req.body as { repo_url?: string; connected_by?: string | null };
    if (!repo_url) return res.status(400).json({ error: 'Repository URL or owner/repo is required.' });
    await requireProjectPermission(req.params.projectId, connected_by, 'can_manage_integrations');
    const parsed = parseRepo(repo_url);
    if (!parsed) return res.status(400).json({ error: 'Use a GitHub repository like owner/repo or https://github.com/owner/repo.' });

    const repoInfo = await githubJson<{ html_url: string; default_branch: string }>(`/repos/${parsed.owner}/${parsed.repo}`);
    const payload = {
      project_id: req.params.projectId,
      owner: parsed.owner,
      repo: parsed.repo,
      repo_url: repoInfo.html_url,
      default_branch: repoInfo.default_branch,
      connected_by: connected_by ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await withTimeout(
      supabase
        .from('project_github_repositories')
        .upsert(payload, { onConflict: 'project_id' })
        .select()
        .single(),
    );
    if (error) throw error;
    res.json({ repository: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.delete('/projects/:projectId/repository', async (req, res) => {
  try {
    const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : req.body?.actor_id;
    await requireProjectPermission(req.params.projectId, actorId, 'can_manage_integrations');
    const { error } = await withTimeout(
      supabase.from('project_github_repositories').delete().eq('project_id', req.params.projectId),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.get('/tasks/:taskId', async (req, res) => {
  try {
    const projectId = await taskProjectId(req.params.taskId);
    const repository = await projectRepo(projectId);
    const { data: links, error } = await withTimeout(
      supabase.from('task_github_links').select('*').eq('task_id', req.params.taskId).order('created_at', { ascending: false }),
    );
    if (error) throw error;
    res.json({ repository, links: links ?? [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/links', async (req, res) => {
  try {
    const { issue_number, branch_name, pull_request_number, created_by } = req.body as {
      issue_number?: number | string | null;
      branch_name?: string | null;
      pull_request_number?: number | string | null;
      created_by?: string | null;
    };
    if (!issue_number && !branch_name && !pull_request_number) {
      return res.status(400).json({ error: 'Add an issue, branch, or pull request link.' });
    }
    await requireTaskPermission(req.params.taskId, created_by, 'can_edit_tasks');
    const projectId = await taskProjectId(req.params.taskId);
    const repository = await projectRepo(projectId);
    if (!repository) return res.status(400).json({ error: 'Connect a GitHub repository first.' });

    let issueUrl: string | null = null;
    let prUrl: string | null = null;
    const issueNumber = issue_number ? Number(issue_number) : null;
    const prNumber = pull_request_number ? Number(pull_request_number) : null;
    if (issueNumber) issueUrl = `https://github.com/${repository.owner}/${repository.repo}/issues/${issueNumber}`;
    if (prNumber) prUrl = `https://github.com/${repository.owner}/${repository.repo}/pull/${prNumber}`;

    const { data, error } = await withTimeout(
      supabase
        .from('task_github_links')
        .insert({
          task_id: req.params.taskId,
          issue_number: issueNumber,
          issue_url: issueUrl,
          branch_name: branch_name?.trim() || null,
          pull_request_number: prNumber,
          pull_request_url: prUrl,
          created_by: created_by ?? null,
        })
        .select()
        .single(),
    );
    if (error) throw error;
    await createActivity(req.params.taskId, created_by, 'github_linked', 'Linked GitHub work', {
      issue_number: issueNumber,
      branch_name: branch_name?.trim() || null,
      pull_request_number: prNumber,
    });
    res.json({ link: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.delete('/tasks/:taskId/links/:linkId', async (req, res) => {
  try {
    const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : req.body?.actor_id;
    await requireTaskPermission(req.params.taskId, actorId, 'can_edit_tasks');
    const { error } = await withTimeout(
      supabase.from('task_github_links').delete().eq('id', req.params.linkId).eq('task_id', req.params.taskId),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/create-issue', async (req, res) => {
  try {
    const { created_by } = req.body as { created_by?: string | null };
    await requireTaskPermission(req.params.taskId, created_by, 'can_edit_tasks');
    const { data: task, error: taskError } = await withTimeout(supabase.from('tasks').select('*').eq('id', req.params.taskId).single());
    if (taskError) throw taskError;
    const repository = await projectRepo(task.project_id);
    if (!repository) return res.status(400).json({ error: 'Connect a GitHub repository first.' });
    if (!process.env.GITHUB_TOKEN) return res.status(400).json({ error: 'GitHub issue creation requires GITHUB_TOKEN on the server.' });

    const issue = await githubJson<{ number: number; html_url: string }>(`/repos/${repository.owner}/${repository.repo}/issues`, {
      method: 'POST',
      body: JSON.stringify({
        title: task.title,
        body: [
          task.description ?? '',
          '',
          `Priority: ${task.priority}`,
          `Estimate: ${task.estimated_days} day(s)`,
          `Technologies: ${(task.assigned_tech ?? []).join(', ') || 'None listed'}`,
        ].join('\n'),
      }),
    });
    const { data: link, error } = await withTimeout(
      supabase
        .from('task_github_links')
        .insert({
          task_id: req.params.taskId,
          issue_number: issue.number,
          issue_url: issue.html_url,
          created_by: created_by ?? null,
        })
        .select()
        .single(),
    );
    if (error) throw error;
    await createActivity(req.params.taskId, created_by, 'github_issue_created', `Created GitHub issue #${issue.number}`, { issue_url: issue.html_url });
    res.json({ issue, link });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/projects/:projectId/import-issues', async (req, res) => {
  try {
    const { created_by, state = 'open' } = req.body as { created_by?: string | null; state?: string };
    await requireProjectPermission(req.params.projectId, created_by, 'can_edit_tasks');
    const repository = await projectRepo(req.params.projectId);
    if (!repository) return res.status(400).json({ error: 'Connect a GitHub repository first.' });
    const issues = await githubJson<Array<{ number: number; title: string; body: string | null; html_url: string; pull_request?: unknown }>>(
      `/repos/${repository.owner}/${repository.repo}/issues?state=${encodeURIComponent(state)}&per_page=25`,
    );
    const onlyIssues = issues.filter((issue) => !issue.pull_request);
    const createdTasks: any[] = [];
    for (const issue of onlyIssues) {
      const { data: task, error: taskError } = await withTimeout(
        supabase
          .from('tasks')
          .insert({
            project_id: req.params.projectId,
            title: issue.title,
            description: issue.body ?? `Imported from GitHub issue #${issue.number}`,
            priority: 'Medium',
            estimated_days: 1,
            assigned_tech: [],
            assigned_to: null,
            status: 'Backlog',
          })
          .select()
          .single(),
      );
      if (taskError) throw taskError;
      await withTimeout(
        supabase.from('task_github_links').insert({
          task_id: task.id,
          issue_number: issue.number,
          issue_url: issue.html_url,
          created_by: created_by ?? null,
        }),
      );
      await createActivity(task.id, created_by, 'github_issue_imported', `Imported GitHub issue #${issue.number}`, { issue_url: issue.html_url });
      createdTasks.push(task);
    }
    res.json({ tasks: createdTasks });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/sync', async (req, res) => {
  try {
    const { user_id } = req.body as { user_id?: string | null };
    const projectId = await taskProjectId(req.params.taskId);
    const repository = await projectRepo(projectId);
    if (!repository) return res.status(400).json({ error: 'Connect a GitHub repository first.' });
    const { data: links, error } = await withTimeout(
      supabase.from('task_github_links').select('*').eq('task_id', req.params.taskId),
    );
    if (error) throw error;

    const commits: any[] = [];
    const pullRequests: any[] = [];
    const syncedLinks: any[] = [];

    for (const link of links ?? []) {
      if (link.branch_name) {
        const branchCommits = await githubJson<any[]>(`/repos/${repository.owner}/${repository.repo}/commits?sha=${encodeURIComponent(link.branch_name)}&per_page=10`);
        commits.push(...branchCommits.map((commit) => ({
          sha: commit.sha,
          message: commit.commit?.message,
          url: commit.html_url,
          author: commit.commit?.author?.name,
          date: commit.commit?.author?.date,
          branch: link.branch_name,
        })));
        const prs = await githubJson<any[]>(`/repos/${repository.owner}/${repository.repo}/pulls?state=all&head=${encodeURIComponent(`${repository.owner}:${link.branch_name}`)}&per_page=10`);
        pullRequests.push(...prs.map((pr) => ({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          merged: Boolean(pr.merged_at),
          url: pr.html_url,
          branch: link.branch_name,
        })));
      }
      if (link.pull_request_number) {
        const pr = await githubJson<any>(`/repos/${repository.owner}/${repository.repo}/pulls/${link.pull_request_number}`);
        pullRequests.push({
          number: pr.number,
          title: pr.title,
          state: pr.state,
          merged: Boolean(pr.merged_at),
          url: pr.html_url,
          branch: pr.head?.ref,
        });
      }
    }

    const uniquePrs = Array.from(new Map(pullRequests.map((pr) => [pr.number, pr])).values());
    for (const pr of uniquePrs) {
      const linked = (links ?? []).find((link) => link.pull_request_number === pr.number || link.branch_name === pr.branch);
      if (!linked) continue;
      const stateLabel = pr.merged ? 'merged' : pr.state;
      const previousLabel = linked.last_pr_merged ? 'merged' : linked.last_pr_state;
      if (stateLabel !== previousLabel) {
        await createActivity(req.params.taskId, user_id, 'github_pr_updated', `GitHub PR #${pr.number} ${stateLabel}`, { pull_request_url: pr.url });
      }
      const { data: updated } = await withTimeout(
        supabase
          .from('task_github_links')
          .update({
            pull_request_number: linked.pull_request_number ?? pr.number,
            pull_request_url: linked.pull_request_url ?? pr.url,
            last_pr_state: pr.state,
            last_pr_merged: pr.merged,
            updated_at: new Date().toISOString(),
          })
          .eq('id', linked.id)
          .select()
          .single(),
      );
      syncedLinks.push(updated);
    }

    res.json({ commits, pull_requests: uniquePrs, links: syncedLinks.length ? syncedLinks : links ?? [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
