import { Router, type Response } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import {
  acceptPendingInvitations,
  getSpaceRole,
  httpError,
  isSpaceRole,
  requireSpaceAdmin,
  spaceProjectIds,
  type HttpError,
} from '../lib/spaces';

const router = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
// Same rule as the spaces.key CHECK constraint.
const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const UNIQUE_VIOLATION = '23505';
const SPACE_FIELDS = 'id, name, key, description, created_by, created_at';

function appUrl(): string {
  const configured = process.env.APP_URL ?? (process.env.ALLOWED_ORIGIN ?? '').split(',')[0] ?? '';
  return (configured.trim() || 'http://localhost:5173').replace(/\/$/, '');
}

function sendError(res: Response, error: unknown) {
  const status = (error as HttpError).status ?? 500;
  if (status >= 500) console.error('[spaces]', error);
  res.status(status).json({ error: (error as Error).message });
}

function validName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw httpError(400, 'Space name is required.');
  if (name.length > MAX_NAME_LENGTH) throw httpError(400, `Space name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  return name;
}

function validKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!key) throw httpError(400, 'Space key is required.');
  if (!KEY_RE.test(key)) {
    throw httpError(400, 'Space key must be 2-10 letters or numbers and start with a letter.');
  }
  return key;
}

function validDescription(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw httpError(400, 'Description must be text.');
  const description = value.trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw httpError(400, `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
  }
  return description || null;
}

async function keyTaken(key: string): Promise<boolean> {
  const { data, error } = await withTimeout(supabase.from('spaces').select('id').eq('key', key).maybeSingle());
  if (error) throw error;
  return Boolean(data);
}

async function adminCount(spaceId: string): Promise<number> {
  const { count, error } = await withTimeout(
    supabase.from('space_members').select('user_id', { count: 'exact', head: true }).eq('space_id', spaceId).eq('role', 'Admin'),
  );
  if (error) throw error;
  return count ?? 0;
}

// List my spaces. Pending invitations for my email are accepted first, so an
// invited person lands straight in the space after signing up.
router.get('/', async (_req, res) => {
  try {
    const userId = res.locals.userId as string;
    const { data: me, error: meError } = await withTimeout(supabase.from('users').select('email').eq('id', userId).maybeSingle());
    if (meError) throw meError;
    await acceptPendingInvitations(userId, me?.email);

    const { data, error } = await withTimeout(
      supabase.from('space_members').select(`role, spaces(${SPACE_FIELDS})`).eq('user_id', userId),
    );
    if (error) throw error;
    const spaces = (data ?? [])
      .filter((row: any) => row.spaces)
      .map((row: any) => ({ ...row.spaces, role: row.role }))
      .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    res.json({ spaces });
  } catch (error) {
    sendError(res, error);
  }
});

// Lets the create form say whether a key is free before submitting.
router.get('/keys/:key', async (req, res) => {
  try {
    const key = validKey(req.params.key);
    res.json({ key, available: !(await keyTaken(key)) });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/', async (req, res) => {
  try {
    const userId = res.locals.userId as string;
    const name = validName(req.body?.name);
    const key = validKey(req.body?.key);
    const description = validDescription(req.body?.description);
    const { data: space, error } = await withTimeout(
      supabase.from('spaces').insert({ name, key, description, created_by: userId }).select(SPACE_FIELDS).single(),
    );
    if (error?.code === UNIQUE_VIOLATION) throw httpError(409, 'This space key is already taken. Choose another one.');
    if (error) throw error;
    const { error: memberError } = await withTimeout(
      supabase.from('space_members').insert({ space_id: space.id, user_id: userId, role: 'Admin' }),
    );
    if (memberError) {
      await withTimeout(supabase.from('spaces').delete().eq('id', space.id));
      throw memberError;
    }
    res.status(201).json({ space: { ...space, role: 'Admin' } });
  } catch (error) {
    sendError(res, error);
  }
});

// Name and description can change; the key is permanent because integrations use it.
router.patch('/:id', async (req, res) => {
  try {
    await requireSpaceAdmin(req.params.id, res.locals.userId);
    const body = req.body ?? {};
    if ('key' in body) throw httpError(400, 'A space key cannot be changed.');
    const changes: { name?: string; description?: string | null } = {};
    if ('name' in body) changes.name = validName(body.name);
    if ('description' in body) changes.description = validDescription(body.description);
    if (Object.keys(changes).length === 0) throw httpError(400, 'Nothing to update.');
    const { data, error } = await withTimeout(
      supabase.from('spaces').update(changes).eq('id', req.params.id).select(SPACE_FIELDS).single(),
    );
    if (error) throw error;
    res.json({ space: data });
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/:id/members', async (req, res) => {
  try {
    const role = await getSpaceRole(req.params.id, res.locals.userId);
    if (!role) throw httpError(404, 'Space not found.');

    const { data: members, error } = await withTimeout(
      supabase
        .from('space_members')
        .select('user_id, role, created_at, users(id, email, full_name, avatar_url, job_title)')
        .eq('space_id', req.params.id)
        .order('created_at'),
    );
    if (error) throw error;

    let invitations: unknown[] = [];
    if (role === 'Admin') {
      const { data, error: invError } = await withTimeout(
        supabase
          .from('space_invitations')
          .select('id, email, role, created_at')
          .eq('space_id', req.params.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      );
      if (invError) throw invError;
      invitations = data ?? [];
    }

    res.json({
      members: (members ?? []).map((m: any) => ({ ...(m.users ?? { id: m.user_id }), role: m.role, joined_at: m.created_at })),
      invitations,
      my_role: role,
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/:id/invitations', async (req, res) => {
  try {
    const spaceId = req.params.id;
    const actorId = res.locals.userId as string;
    await requireSpaceAdmin(spaceId, actorId);

    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const role = req.body?.role ?? 'Member';
    if (!EMAIL_RE.test(email)) throw httpError(400, 'Enter a valid email address.');
    if (!isSpaceRole(role)) throw httpError(400, 'Choose a valid role.');

    const { data: existing, error: userError } = await withTimeout(
      supabase.from('users').select('id, email, full_name, avatar_url').ilike('email', email.replace(/[\\%_]/g, '\\$&')).maybeSingle(),
    );
    if (userError) throw userError;

    if (existing?.id) {
      if (await getSpaceRole(spaceId, existing.id)) throw httpError(409, 'This person is already a member of the space.');
      const { error } = await withTimeout(supabase.from('space_members').insert({ space_id: spaceId, user_id: existing.id, role }));
      if (error) throw error;
      return res.status(201).json({ added: true, member: { ...existing, role } });
    }

    const { data: invitation, error } = await withTimeout(
      supabase
        .from('space_invitations')
        .upsert({ space_id: spaceId, email, role, invited_by: actorId, status: 'pending' }, { onConflict: 'space_id,email' })
        .select('id, email, role, created_at')
        .single(),
    );
    if (error) throw error;

    // Supabase sends the invite email; the link opens /set-password, and the
    // invitation is accepted the first time they load their spaces.
    const { error: emailError } = await supabase.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl()}/set-password` });
    if (emailError) console.warn('[spaces] invite email failed', email, emailError.message);

    res.status(201).json({ added: false, invitation, email_sent: !emailError, email_error: emailError?.message ?? null });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id/invitations/:invitationId', async (req, res) => {
  try {
    await requireSpaceAdmin(req.params.id, res.locals.userId);
    const { error } = await withTimeout(
      supabase.from('space_invitations').update({ status: 'revoked' }).eq('id', req.params.invitationId).eq('space_id', req.params.id),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

router.patch('/:id/members/:userId', async (req, res) => {
  try {
    const { id: spaceId, userId: targetId } = req.params;
    await requireSpaceAdmin(spaceId, res.locals.userId);
    const role = req.body?.role;
    if (!isSpaceRole(role)) throw httpError(400, 'Choose a valid role.');

    const current = await getSpaceRole(spaceId, targetId);
    if (!current) throw httpError(404, 'Member not found.');
    if (current === 'Admin' && role !== 'Admin' && (await adminCount(spaceId)) <= 1) {
      throw httpError(400, 'A space needs at least one admin. Make someone else admin first.');
    }

    const { error } = await withTimeout(
      supabase.from('space_members').update({ role }).eq('space_id', spaceId).eq('user_id', targetId),
    );
    if (error) throw error;
    res.json({ success: true, role });
  } catch (error) {
    sendError(res, error);
  }
});

router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { id: spaceId, userId: targetId } = req.params;
    await requireSpaceAdmin(spaceId, res.locals.userId);

    const current = await getSpaceRole(spaceId, targetId);
    if (!current) throw httpError(404, 'Member not found.');
    if (current === 'Admin' && (await adminCount(spaceId)) <= 1) {
      throw httpError(400, 'A space needs at least one admin. Make someone else admin first.');
    }

    const projectIds = await spaceProjectIds(spaceId);
    if (projectIds.length > 0) {
      const { error: assignmentError } = await withTimeout(
        supabase.from('team_assignments').delete().eq('user_id', targetId).in('project_id', projectIds),
      );
      if (assignmentError) throw assignmentError;
    }
    const { error } = await withTimeout(
      supabase.from('space_members').delete().eq('space_id', spaceId).eq('user_id', targetId),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    sendError(res, error);
  }
});

export default router;
