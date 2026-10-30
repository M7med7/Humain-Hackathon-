import type { NextFunction, Request, Response } from 'express';
import { assertInSpace, assertUsersInSpace, canCreateProjects, getSpaceRole, httpError, type HttpError } from './spaces';

type RouteRule = { method: string; pattern: RegExp };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_RE = new RegExp(`^${UUID}$`, 'i');

// Personal or space-management routes that do not act inside the active space.
const SPACE_FREE_ROUTES: RouteRule[] = [
  { method: '*', pattern: /^\/spaces(\/|$)/ },
  { method: '*', pattern: /^\/notifications(\/|$)/ },
  { method: '*', pattern: /^\/calendar\/(?!tasks\/)/ },
  { method: 'PATCH', pattern: /^\/users\/[^/]+$/ },
  { method: 'POST', pattern: /^\/users\/[^/]+\/(cv|avatar)$/ },
];

// Starting or saving a new plan creates a project in the space.
const PROJECT_CREATION_ROUTES: RouteRule[] = [
  { method: 'POST', pattern: /^\/projects$/ },
  { method: 'POST', pattern: /^\/ai\/(generate|save|improve|refine)$/ },
];

const PATH_RESOURCES = [
  { kind: 'project', pattern: new RegExp(`(?:^|/)(?:projects|from-project)/(${UUID})`, 'gi') },
  { kind: 'task', pattern: new RegExp(`(?:^|/)tasks/(${UUID})`, 'gi') },
  { kind: 'share', pattern: new RegExp(`(?:^|/)shares/(${UUID})`, 'gi') },
  { kind: 'template', pattern: new RegExp(`^/templates/(${UUID})`, 'gi') },
] as const;

const FIELD_RESOURCES = [
  { kind: 'project', fields: ['project_id', 'projectId'] },
  { kind: 'task', fields: ['task_id', 'taskId', 'depends_on_task_id', 'dependsOnTaskId'] },
  { kind: 'template', fields: ['template_id', 'templateId'] },
] as const;

const USER_FIELDS = ['assigned_to', 'team_members', 'databaseMembers', 'mentioned_user_ids'];

const matches = (rules: RouteRule[], req: Request) =>
  rules.some((rule) => (rule.method === '*' || rule.method === req.method) && rule.pattern.test(req.path));

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return [];
}

function fieldValues(req: Request, field: string): string[] {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>)[field] : undefined;
  const query = (req.query as Record<string, unknown>)[field];
  return [...stringValues(body), ...stringValues(query)];
}

async function checkResources(req: Request, spaceId: string, userId: string) {
  const checks: Promise<void>[] = [];
  for (const { kind, pattern } of PATH_RESOURCES) {
    for (const match of req.path.matchAll(pattern)) if (match[1]) checks.push(assertInSpace(kind, match[1], spaceId));
  }
  for (const { kind, fields } of FIELD_RESOURCES) {
    for (const field of fields) {
      for (const id of fieldValues(req, field).filter((v) => UUID_RE.test(v))) checks.push(assertInSpace(kind, id, spaceId));
    }
  }

  const userIds = USER_FIELDS.flatMap((field) => fieldValues(req, field));
  if (req.method === 'POST' && /^\/projects\/[^/]+\/members$/.test(req.path)) userIds.push(...fieldValues(req, 'user_id'));
  const profileTarget = req.path.match(new RegExp(`^/users/(${UUID})/profile$`, 'i'))?.[1];
  if (profileTarget && profileTarget !== userId) userIds.push(profileTarget);
  checks.push(assertUsersInSpace(userIds.filter((id) => UUID_RE.test(id)), spaceId));

  await Promise.all(checks);
}

/**
 * Resolves the active space from the X-Space-Id header, confirms the caller is a
 * member, and rejects any project/task/share/template or user that belongs to a
 * different space. Must run after requireAuth.
 */
export async function requireSpace(req: Request, res: Response, next: NextFunction) {
  const userId = res.locals.userId as string | undefined;
  if (req.method === 'OPTIONS' || !userId || matches(SPACE_FREE_ROUTES, req)) return next();

  const spaceId = String(req.headers['x-space-id'] ?? '');
  if (!UUID_RE.test(spaceId)) return res.status(400).json({ error: 'Choose a space first.' });

  try {
    const role = await getSpaceRole(spaceId, userId);
    if (!role) return res.status(403).json({ error: 'You are not a member of this space.' });
    if (matches(PROJECT_CREATION_ROUTES, req) && !canCreateProjects(role)) {
      throw httpError(403, 'Only admins and developers can create projects.');
    }

    await checkResources(req, spaceId, userId);
    res.locals.spaceId = spaceId;
    res.locals.spaceRole = role;
    next();
  } catch (error) {
    const status = (error as HttpError).status;
    if (status) return res.status(status).json({ error: (error as Error).message });
    console.error('[spaces] access check failed', error);
    res.status(503).json({ error: 'Could not verify space access. Please try again.' });
  }
}
