import { supabase } from './supabase';
import { withTimeout } from './timeout';

export const SPACE_ROLES = ['Admin', 'Developer', 'Member', 'Guest'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];

export type HttpError = Error & { status?: number };

export function httpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

export function isSpaceRole(value: unknown): value is SpaceRole {
  return typeof value === 'string' && (SPACE_ROLES as readonly string[]).includes(value);
}

// Admins and developers build projects; members (finance, HR, ...) and guests follow along.
export function canCreateProjects(role: SpaceRole | null | undefined): boolean {
  return role === 'Admin' || role === 'Developer';
}

export async function getSpaceRole(spaceId: string, userId: string): Promise<SpaceRole | null> {
  const { data, error } = await withTimeout(
    supabase.from('space_members').select('role').eq('space_id', spaceId).eq('user_id', userId).maybeSingle(),
  );
  if (error) throw error;
  return isSpaceRole(data?.role) ? data.role : null;
}

export async function requireSpaceAdmin(spaceId: string, userId: string): Promise<void> {
  const role = await getSpaceRole(spaceId, userId);
  if (!role) throw httpError(404, 'Space not found.');
  if (role !== 'Admin') throw httpError(403, 'Only space admins can do this.');
}

export async function spaceProjectIds(spaceId: string): Promise<string[]> {
  const { data, error } = await withTimeout(supabase.from('projects').select('id').eq('space_id', spaceId));
  if (error) throw error;
  return (data ?? []).map((row: { id: string }) => row.id);
}

export async function spaceMemberIds(spaceId: string): Promise<string[]> {
  const { data, error } = await withTimeout(supabase.from('space_members').select('user_id').eq('space_id', spaceId));
  if (error) throw error;
  return (data ?? []).map((row: { user_id: string }) => row.user_id);
}

type OwnedResource = 'project' | 'task' | 'share' | 'template';

async function resourceSpaceId(kind: OwnedResource, id: string): Promise<string | null | undefined> {
  if (kind === 'project') {
    const { data, error } = await withTimeout(supabase.from('projects').select('space_id').eq('id', id).maybeSingle());
    if (error) throw error;
    return data ? data.space_id : undefined;
  }
  if (kind === 'task') {
    const { data, error } = await withTimeout(
      supabase.from('tasks').select('project_id, projects(space_id)').eq('id', id).maybeSingle(),
    );
    if (error) throw error;
    return data ? ((data.projects as { space_id?: string } | null)?.space_id ?? null) : undefined;
  }
  if (kind === 'share') {
    const { data, error } = await withTimeout(
      supabase.from('project_client_shares').select('project_id, projects(space_id)').eq('id', id).maybeSingle(),
    );
    if (error) throw error;
    return data ? ((data.projects as { space_id?: string } | null)?.space_id ?? null) : undefined;
  }
  const { data, error } = await withTimeout(supabase.from('project_templates').select('space_id').eq('id', id).maybeSingle());
  if (error) throw error;
  return data ? data.space_id : undefined;
}

/**
 * Throws 404 when the resource exists but belongs to another space. Unknown ids
 * pass through so routes keep their own not-found handling (and new records,
 * such as a project being saved for the first time, can be created).
 */
export async function assertInSpace(kind: OwnedResource, id: string, spaceId: string): Promise<void> {
  const owner = await resourceSpaceId(kind, id);
  if (owner === undefined) return;
  if (owner !== spaceId) throw httpError(404, `${kind.charAt(0).toUpperCase()}${kind.slice(1)} not found.`);
}

export async function assertUsersInSpace(userIds: string[], spaceId: string): Promise<void> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return;
  const { data, error } = await withTimeout(
    supabase.from('space_members').select('user_id').eq('space_id', spaceId).in('user_id', unique),
  );
  if (error) throw error;
  if ((data ?? []).length !== unique.length) throw httpError(400, 'Everyone involved must be a member of this space.');
}

/** Moves pending invitations for this email into memberships. Returns the number accepted. */
export async function acceptPendingInvitations(userId: string, email: string | null | undefined): Promise<number> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return 0;

  const { data: invitations, error } = await withTimeout(
    supabase.from('space_invitations').select('id, space_id, role').eq('email', normalized).eq('status', 'pending'),
  );
  if (error) throw error;
  if (!invitations?.length) return 0;

  const { error: memberError } = await withTimeout(
    supabase.from('space_members').upsert(
      invitations.map((inv: { space_id: string; role: string }) => ({ space_id: inv.space_id, user_id: userId, role: inv.role })),
      { onConflict: 'space_id,user_id', ignoreDuplicates: true },
    ),
  );
  if (memberError) throw memberError;

  const { error: updateError } = await withTimeout(
    supabase
      .from('space_invitations')
      .update({ status: 'accepted' })
      .in('id', invitations.map((inv: { id: string }) => inv.id)),
  );
  if (updateError) throw updateError;
  return invitations.length;
}
