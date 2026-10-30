import { supabase } from './supabase';
import { withTimeout } from './timeout';
import { getSpaceRole } from './spaces';

export type ProjectRole = 'Owner' | 'Admin' | 'Member' | 'Guest';

export interface ProjectPermissions {
  role: ProjectRole | null;
  can_view_project: boolean;
  can_manage_project: boolean;
  can_delete_project: boolean;
  can_manage_members: boolean;
  can_manage_integrations: boolean;
  can_edit_tasks: boolean;
  can_comment: boolean;
  can_upload_files: boolean;
  can_export: boolean;
  can_view_capacity: boolean;
}

const ROLE_RANK: Record<ProjectRole, number> = {
  Guest: 1,
  Member: 2,
  Admin: 3,
  Owner: 4,
};

export function normalizeRole(role: unknown): ProjectRole {
  if (role === 'Owner' || role === 'Admin' || role === 'Member' || role === 'Guest') return role;
  if (role === 'Viewer') return 'Guest';
  return 'Member';
}

export function permissionsForRole(role: ProjectRole | null): ProjectPermissions {
  const rank = role ? ROLE_RANK[role] : 0;
  return {
    role,
    can_view_project: rank > 0,
    can_manage_project: rank >= ROLE_RANK.Admin,
    can_delete_project: role === 'Owner',
    can_manage_members: rank >= ROLE_RANK.Admin,
    can_manage_integrations: rank >= ROLE_RANK.Admin,
    can_edit_tasks: rank >= ROLE_RANK.Member,
    can_comment: rank >= ROLE_RANK.Guest,
    can_upload_files: rank >= ROLE_RANK.Member,
    can_export: rank >= ROLE_RANK.Member,
    can_view_capacity: rank >= ROLE_RANK.Member,
  };
}

export async function getProjectRole(projectId: string, userId?: string | null): Promise<ProjectRole | null> {
  if (!userId) return null;
  const [{ data: project }, { data: assignment }] = await Promise.all([
    withTimeout(supabase.from('projects').select('created_by, space_id').eq('id', projectId).maybeSingle()),
    withTimeout(supabase.from('team_assignments').select('role').eq('project_id', projectId).eq('user_id', userId).maybeSingle()),
  ]);
  if (!project) return null;
  const spaceRole = project.space_id ? await getSpaceRole(project.space_id, userId) : null;
  // Space admins manage every project in their space; project creators own theirs.
  if (spaceRole === 'Admin' || project.created_by === userId) return 'Owner';
  if (assignment?.role) return normalizeRole(assignment.role);
  // Anyone else in the space can follow the project: view and comment.
  return spaceRole ? 'Guest' : null;
}

export async function getProjectPermissions(projectId: string, userId?: string | null): Promise<ProjectPermissions> {
  return permissionsForRole(await getProjectRole(projectId, userId));
}

export async function getTaskProjectId(taskId: string): Promise<string> {
  const { data, error } = await withTimeout(supabase.from('tasks').select('project_id').eq('id', taskId).single());
  if (error) throw error;
  return data.project_id;
}

export async function requireProjectPermission(projectId: string, userId: string | null | undefined, permission: keyof ProjectPermissions) {
  const permissions = await getProjectPermissions(projectId, userId);
  if (!permissions[permission]) {
    const message =
      permission === 'can_delete_project'
        ? 'Only the project owner can delete this project.'
        : permission === 'can_manage_members'
        ? 'Only owners and admins can manage project members.'
        : permission === 'can_manage_integrations'
        ? 'Only owners and admins can manage integrations.'
        : permission === 'can_export'
        ? 'Your role cannot export this project.'
        : 'Your role cannot perform this action.';
    const error = new Error(message) as Error & { status?: number };
    error.status = 403;
    throw error;
  }
  return permissions;
}

export async function requireTaskPermission(taskId: string, userId: string | null | undefined, permission: keyof ProjectPermissions) {
  const projectId = await getTaskProjectId(taskId);
  await requireProjectPermission(projectId, userId, permission);
  return projectId;
}
