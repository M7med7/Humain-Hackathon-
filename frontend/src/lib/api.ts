import { supabase } from './supabase';
// ── AI Plan Quality types ─────────────────────────────────────────────────────

export interface GeneratedTask {
  id: string;
  title: string;
  description: string;
  estimated_days: number;
  assigned_tech: string[];
  assigned_to: string;
  priority?: string;
  acceptance_criteria: string[];
  definition_of_done: string[];
}

export interface GeneratedSchedule {
  project_summary: string;
  tasks: GeneratedTask[];
  dependencies: Array<{
    task_id: string;
    depends_on_task_id: string;
    dependency_type: string;
  }>;
  technology_recommendations: Array<{
    tech_name: string;
    category: string;
    reasoning: string;
  }>;
}

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

export interface AssignmentRecommendation {
  userId: string;
  confidence: number;       // 0–100
  reason: string;           // short human-readable explanation
  skillMatches: string[];
  skillGaps: string[];
  overloadWarning?: string;
  trainingSuggestion?: string;
}

export interface PlanPreviewResult {
  success: boolean;
  projectId: string;
  schedule: GeneratedSchedule;
  qualityReport: QualityReport;
  savedDescription: string;
  durationWeeks: number;
  databaseMembers: string[];
  totalDays: number;
  offline?: boolean;
  recommendations?: Record<string, AssignmentRecommendation>; // keyed by task ID
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  scheduleSnapshot?: GeneratedSchedule;
}

export interface TaskDiff {
  added: GeneratedTask[];
  removed: GeneratedTask[];
  modified: Array<{ before: GeneratedTask; after: GeneratedTask }>;
  unchanged: GeneratedTask[];
}

export interface RefinementResult extends PlanPreviewResult {
  refinementSummary: string;
}

export function computeTaskDiff(before: GeneratedSchedule, after: GeneratedSchedule): TaskDiff {
  const beforeById = new Map(before.tasks.map((t) => [t.id, t]));
  const afterById  = new Map(after.tasks.map((t) => [t.id, t]));

  const added    = after.tasks.filter((t) => !beforeById.has(t.id));
  const removed  = before.tasks.filter((t) => !afterById.has(t.id));
  const modified: TaskDiff['modified'] = [];
  const unchanged: GeneratedTask[] = [];

  for (const afterTask of after.tasks) {
    const beforeTask = beforeById.get(afterTask.id);
    if (!beforeTask) continue;
    if (JSON.stringify(afterTask) !== JSON.stringify(beforeTask)) {
      modified.push({ before: beforeTask, after: afterTask });
    } else {
      unchanged.push(afterTask);
    }
  }

  return { added, removed, modified, unchanged };
}

// ─────────────────────────────────────────────────────────────────────────────

export type HealthBadge = 'Healthy' | 'At Risk' | 'Delayed' | 'Blocked';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  team_count: number;
  progress: number;
  duration_weeks?: number | null;
  health_score?: number;
  risk_level?: RiskLevel;
  risk_reasons?: string[];
  overdue_count?: number;
  blocked_count?: number;
  next_deadline?: string | null;
  overload_warning?: boolean;
  health_badge?: HealthBadge;
}

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  estimated_days: number;
  assigned_tech: string[];
  assigned_to: string | null;
  acceptance_criteria?: TaskChecklistItem[];
  definition_of_done?: TaskChecklistItem[];
  completed_by: string | null;
  completed_at: string | null;
  start_date?: string | null;
  end_date?: string | null;
  created_at: string;
  updated_at: string;
  project_name?: string;
  completer_name?: string | null;
  blocked_by?: TaskDependencyRef[];
  unlocks?: TaskDependencyRef[];
  is_blocked?: boolean;
  blocking_count?: number;
  latest_activity_at?: string | null;
}

export interface TaskChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface CollaborationUser {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string | null;
  content: string;
  edited_at: string | null;
  created_at: string;
  updated_at: string;
  users?: CollaborationUser | null;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string | null;
  file_name: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  is_image: boolean;
  created_at: string;
  users?: CollaborationUser | null;
}

export interface TaskActivity {
  id: string;
  task_id: string;
  user_id: string | null;
  activity_type: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
  users?: CollaborationUser | null;
}

export interface NotificationPreferences {
  assignments: boolean;
  mentions: boolean;
  comments: boolean;
  status_changes: boolean;
  due_reminders: boolean;
  overdue_alerts: boolean;
  project_risk: boolean;
}

export interface AppNotification {
  id: string;
  user_id: string;
  actor_id: string | null;
  task_id: string | null;
  project_id: string | null;
  notification_type: string;
  message: string;
  link_path: string | null;
  read_at: string | null;
  created_at: string;
  tasks?: { title: string; project_id: string | null } | null;
  projects?: { name: string } | null;
}

export interface GitHubRepository {
  owner: string;
  repo: string;
  repo_url: string;
  default_branch?: string | null;
}

export interface GitHubTaskLink {
  id: string;
  task_id: string;
  issue_number: number | null;
  issue_url: string | null;
  branch_name: string | null;
  pull_request_number: number | null;
  pull_request_url: string | null;
  last_pr_state: string | null;
  last_pr_merged: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  url: string;
  author: string | null;
  date: string | null;
  branch?: string | null;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: string;
  merged: boolean;
  url: string;
  branch?: string | null;
}

export interface CalendarConnection {
  id: string;
  user_id: string;
  provider: 'google' | 'outlook';
  calendar_id: string | null;
  calendar_name: string | null;
  timezone: string | null;
  sync_enabled: boolean;
  create_work_blocks: boolean;
  connected_at: string;
  updated_at: string;
}

export interface TaskCalendarEvent {
  id: string;
  task_id: string;
  user_id: string;
  provider: 'google' | 'outlook';
  event_type: 'due_date' | 'work_block';
  external_event_id: string | null;
  calendar_id: string | null;
  sync_enabled: boolean;
  sync_status: string | null;
  last_error: string | null;
  last_synced_at: string | null;
}

export interface SlackIntegration {
  id: string;
  project_id: string;
  channel_name: string | null;
  connected_by: string | null;
  assignment_notifications: boolean;
  overdue_alerts: boolean;
  project_risk_alerts: boolean;
  mention_notifications: boolean;
  summary_notifications: boolean;
  summary_frequency: 'daily' | 'weekly' | 'off';
  last_summary_sent_at: string | null;
  last_error: string | null;
  connected_at: string;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  task_id: string;
  project_id: string;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  minutes: number;
  note: string | null;
  source: 'timer' | 'manual';
  created_at: string;
  users?: CollaborationUser | null;
}

export interface TaskTimeSummary {
  id: string;
  title: string;
  estimated_days: number;
  assigned_to: string | null;
  status: string;
  actual_minutes: number;
  estimated_minutes: number;
  estimate_accuracy: number | null;
}

export interface PortfolioMilestone {
  id: string;
  title: string;
  due_date: string;
  status: string;
  priority: string;
  blocked: boolean;
}

export interface PortfolioProject {
  id: string;
  name: string;
  description: string;
  status: string;
  owner_id: string | null;
  owner_name: string | null;
  created_at: string;
  start_date: string | null;
  end_date: string | null;
  progress: number;
  task_count: number;
  overdue_count: number;
  blocked_count: number;
  high_priority_count: number;
  health_score: number;
  risk_level: RiskLevel;
  milestones: PortfolioMilestone[];
}

export interface PortfolioWorkload {
  user_id: string;
  name: string;
  email: string;
  open_tasks: number;
  estimated_days: number;
  project_count: number;
  projects: string[];
  overloaded: boolean;
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  phases: string[];
  recommended_technologies: string[];
  task_blueprints?: Array<Record<string, unknown>>;
  source_project_id?: string | null;
  is_custom?: boolean;
}

export interface TaskDependencyRef {
  id: string;
  title: string;
  status: string;
}

export interface UserCompletedTask {
  id: string;
  title: string;
  project_name: string | null;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  phone?: string | null;
  created_at: string;
  space_role?: SpaceRole;
  task_count: number;
  project_count: number;
  completed_count: number;
  completed_tasks: { id: string; title: string; project_name: string | null }[];
  total_estimated_days: number;
  skills: string[];
  experience_summary: string | null;
  cv_parsed_at: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  x_url: string | null;
  job_title?: string | null;
}

export interface ProfileData extends User {
  weekly_streak: number;
  achievements: string[];
}

export interface ProjectMember {
  user_id: string;
  role: string;
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  skills?: string[];
  experience_summary?: string | null;
}

export interface ProjectInvitation {
  id: string;
  project_id: string;
  email: string;
  role: ProjectRole;
  invited_by: string | null;
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
  updated_at: string;
}

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

export interface ClientShareSettings {
  show_tasks: boolean;
  show_milestones: boolean;
  show_completed_tasks: boolean;
  show_current_tasks: boolean;
  show_upcoming_tasks: boolean;
  show_internal_risks: boolean;
  allow_client_comments: boolean;
  brand_label: string;
}

export interface ProjectClientShare {
  id: string;
  project_id: string;
  token: string;
  settings: ClientShareSettings;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
}

export interface ClientPortalTask {
  id: string;
  title: string;
  status: string;
  priority: string;
  start_date: string | null;
  end_date: string | null;
}

export interface ClientPortalComment {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
}

export interface ClientPortalPayload {
  share: { id: string; token: string; settings: ClientShareSettings };
  project: {
    id: string;
    name: string;
    description: string;
    status: string;
    duration_weeks: number | null;
    created_at: string;
    progress: number;
    task_count: number;
    completed_count: number;
  };
  tasks: ClientPortalTask[];
  milestones: ClientPortalTask[];
  risk_summary: { overdue_count: number; blocked_count: number; summary: string } | null;
  comments: ClientPortalComment[];
}

export interface SearchFilters {
  q?: string;
  user_id?: string | null;
  status?: string;
  priority?: string;
  assignee?: string;
  project_id?: string;
  risk?: string;
  tech?: string;
  due?: string;
  blocked?: boolean;
  my_tasks?: boolean;
  overdue?: boolean;
  high_priority?: boolean;
  due_this_week?: boolean;
}

export interface SearchResult {
  type: 'project' | 'task' | 'comment' | 'file';
  id: string;
  title: string;
  subtitle: string | null;
  project_id: string;
  project_name: string;
  url: string;
  matched: string;
  meta: Record<string, unknown>;
  created_at: string;
}

// ── Weekly Report types ────────────────────────────────────────────────────────

export interface ReportCompletedTask {
  id: string;
  title: string;
  priority: string;
  completed_at: string;
  completed_by_name: string | null;
  assigned_name: string | null;
  estimated_days: number;
}

export interface ReportDelayedTask {
  id: string;
  title: string;
  priority: string;
  end_date: string;
  days_overdue: number;
  assigned_name: string | null;
  status: string;
}

export interface ReportBlockedTask {
  id: string;
  title: string;
  priority: string;
  blocking_count: number;
  assigned_name: string | null;
  status: string;
}

export interface ReportAtRiskTask {
  task: { id: string; title: string; priority: string; status: string; assigned_name: string | null; end_date: string | null };
  reason: string;
}

export interface ReportWorkloadMember {
  user_id: string;
  name: string;
  email: string;
  open_tasks: number;
  completed_this_week: number;
  estimated_days: number;
  overdue_count: number;
  status: 'Overloaded' | 'Healthy' | 'Available';
}

export interface ReportChanges {
  completed_this_week: number;
  completed_last_week: number;
  completion_delta: number;
  completion_delta_label: string;
  new_tasks_added: number;
  velocity_trend: 'improving' | 'slowing';
}

export interface ReportSections {
  executive_summary: string;
  completed_tasks: ReportCompletedTask[];
  delayed_tasks: ReportDelayedTask[];
  blocked_tasks: ReportBlockedTask[];
  at_risk_tasks: ReportAtRiskTask[];
  team_workload: ReportWorkloadMember[];
  changes_from_last_week: ReportChanges;
  next_week_priorities: string[];
  recommendations: string[];
}

export interface WeeklyReport {
  project: { id: string; name: string; description: string; duration_weeks: number };
  period: string;
  generated_at: string;
  stats: { total: number; done: number; progress: number; overdue: number; blocked: number; at_risk: number; completed_this_week: number };
  sections: ReportSections;
}

// ── Health Dashboard types ─────────────────────────────────────────────────────

export interface HealthStats {
  total: number;
  done: number;
  in_progress: number;
  overdue: number;
  blocked: number;
  unassigned: number;
  high_priority_open: number;
}

export interface HealthOverdueTask {
  id: string;
  title: string;
  priority: string;
  end_date: string;
  days_overdue: number;
  assigned_name: string | null;
}

export interface HealthBlockedTask {
  id: string;
  title: string;
  priority: string;
  blocking_count: number;
  assigned_name: string | null;
}

export interface HealthDeadline {
  id: string;
  title: string;
  priority: string;
  end_date: string;
  days_until: number;
  assigned_name: string | null;
}

export interface HealthWorkloadMember {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  open_tasks: number;
  completed_tasks: number;
  estimated_days: number;
  overdue_count: number;
}

export interface HealthTimeline {
  score: number;
  label: 'On Track' | 'At Risk' | 'Delayed';
  remaining_days: number;
  available_days: number;
  weeks_remaining: number;
}

export interface HealthActivityItem {
  task_id: string;
  task_title: string;
  actor_name: string;
  activity_type: string;
  summary: string;
  created_at: string;
}

export interface HealthBurndownPoint {
  label: string;
  completed: number;
  cumulative: number;
}

export interface HealthAttentionItem {
  severity: 'high' | 'medium' | 'low';
  text: string;
  action: string;
}

export interface ProjectHealthReport {
  project: { id: string; name: string; description: string; status: string; duration_weeks: number; created_at: string };
  health_score: number;
  risk_level: 'Low' | 'Medium' | 'High' | 'Critical';
  risk_reasons: string[];
  progress: number;
  stats: HealthStats;
  overdue_tasks: HealthOverdueTask[];
  blocked_tasks: HealthBlockedTask[];
  upcoming_deadlines: HealthDeadline[];
  workload: HealthWorkloadMember[];
  timeline_confidence: HealthTimeline;
  recent_activity: HealthActivityItem[];
  burndown: HealthBurndownPoint[];
  attention_items: HealthAttentionItem[];
}

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
  acceptance_criteria: TaskChecklistItem[];
}

export interface ImportAnalysisFinding {
  type: 'dependency' | 'workload' | 'scope_gap' | 'priority';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affected_tasks: string[];
}

export interface ImportAnalysis {
  summary: string;
  risk_level: 'Low' | 'Medium' | 'High';
  findings: ImportAnalysisFinding[];
  recommendations: string[];
}

const BASE_URL = `${import.meta.env.VITE_API_URL ?? 'http://localhost:5001'}/api`;

// Every request runs inside the active space; SpaceGate sets this before any page loads.
let activeSpaceId: string | null = null;

export function setActiveSpaceId(spaceId: string | null): void {
  activeSpaceId = spaceId;
}

// The backend rejects requests without a valid Supabase session token.
export async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(activeSpaceId ? { 'X-Space-Id': activeSpaceId } : {}),
  };
}

async function attempt<T>(path: string, options: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...options?.headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      let message = `Request failed (${res.status})`;
      try {
        const parsed = JSON.parse(body);
        if (parsed.error) message = parsed.error;
      } catch {
        if (body) message = body;
      }
      throw Object.assign(new Error(message), { status: res.status });
    }
    const data = await res.json();
    if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
      throw new Error(data.error);
    }
    return data as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('__timeout__', { cause: error });
    }
    if (error instanceof TypeError) {
      throw new Error('Could not reach the server. Make sure the backend is running.', { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function request<T>(path: string, options?: RequestInit, timeoutMs = 20_000): Promise<T> {
  // Long-running AI requests do not retry, because retrying can duplicate expensive work.
  // Regular requests retry up to 2 times (3s apart) to survive Render cold starts.
  const maxRetries = timeoutMs >= 100_000 ? 0 : 2;

  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await attempt<T>(path, options, timeoutMs);
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === '__timeout__';
      if (isTimeout && i < maxRetries) {
        await new Promise<void>((r) => setTimeout(r, 3_000));
        continue;
      }
      if (isTimeout) throw new Error('Request timed out. Please try again.', { cause: err });
      throw err;
    }
  }
  throw new Error('Request timed out. Please try again.');
}

export type SpaceRole = 'Admin' | 'Developer' | 'Member' | 'Guest';
export const SPACE_ROLES: SpaceRole[] = ['Admin', 'Developer', 'Member', 'Guest'];

// Mirrors the spaces.key CHECK constraint: permanent code used by API and MCP clients.
export const SPACE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const SPACE_KEY_MAX_LENGTH = 10;
export const SPACE_DESCRIPTION_MAX_LENGTH = 500;

export interface Space {
  id: string;
  name: string;
  key: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  role: SpaceRole;
}

export interface SpaceMember {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  job_title?: string | null;
  role: SpaceRole;
  joined_at: string;
}

export interface SpaceInvitation {
  id: string;
  email: string;
  role: SpaceRole;
  created_at: string;
}

export interface NewSpace {
  name: string;
  key: string;
  description: string;
}

export type SpaceInviteResult =
  | { added: true; member: SpaceMember }
  | { added: false; invitation: SpaceInvitation; email_sent: boolean; email_error: string | null };

export const api = {
  spaces: {
    list: () => request<{ spaces: Space[] }>('/spaces'),
    create: (input: NewSpace) =>
      request<{ space: Space }>('/spaces', { method: 'POST', body: JSON.stringify(input) }),
    checkKey: (key: string) =>
      request<{ key: string; available: boolean }>(`/spaces/keys/${encodeURIComponent(key)}`),
    update: (spaceId: string, changes: { name?: string; description?: string }) =>
      request<{ space: Space }>(`/spaces/${spaceId}`, { method: 'PATCH', body: JSON.stringify(changes) }),
    members: (spaceId: string) =>
      request<{ members: SpaceMember[]; invitations: SpaceInvitation[]; my_role: SpaceRole }>(`/spaces/${spaceId}/members`),
    invite: (spaceId: string, email: string, role: SpaceRole) =>
      request<SpaceInviteResult>(`/spaces/${spaceId}/invitations`, { method: 'POST', body: JSON.stringify({ email, role }) }),
    revokeInvitation: (spaceId: string, invitationId: string) =>
      request<{ success: boolean }>(`/spaces/${spaceId}/invitations/${invitationId}`, { method: 'DELETE' }),
    updateMemberRole: (spaceId: string, userId: string, role: SpaceRole) =>
      request<{ success: boolean }>(`/spaces/${spaceId}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    removeMember: (spaceId: string, userId: string) =>
      request<{ success: boolean }>(`/spaces/${spaceId}/members/${userId}`, { method: 'DELETE' }),
  },
  projects: {
    list: () => request<{ projects: Project[] }>('/projects'),
    get: (id: string, userId?: string | null) =>
      request<{ project: Project; tasks: Task[]; members: ProjectMember[]; invitations?: ProjectInvitation[]; permissions?: ProjectPermissions }>(`/projects/${id}${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`),
    delete: (id: string, actorId?: string | null) =>
      request<{ success: boolean }>(`/projects/${id}${actorId ? `?actor_id=${encodeURIComponent(actorId)}` : ''}`, { method: 'DELETE' }),
    addMember: (projectId: string, userId: string, role: ProjectRole = 'Member', actorId?: string | null) =>
      request<{ success: boolean }>(`/projects/${projectId}/members`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId, role, actor_id: actorId ?? null }),
      }),
    inviteMember: (projectId: string, data: { email: string; role: ProjectRole; actor_id?: string | null }) =>
      request<{ assigned: boolean; user?: User; role?: ProjectRole; invitation?: ProjectInvitation }>(`/projects/${projectId}/invitations`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateMemberRole: (projectId: string, userId: string, role: ProjectRole, actorId?: string | null) =>
      request<{ assignment: { user_id: string; role: ProjectRole } }>(`/projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, actor_id: actorId ?? null }),
      }),
    removeMember: (projectId: string, userId: string, actorId?: string | null) =>
      request<{ success: boolean }>(`/projects/${projectId}/members/${userId}${actorId ? `?actor_id=${encodeURIComponent(actorId)}` : ''}`, {
        method: 'DELETE',
      }),
  },
  tasks: {
    list: () => request<{ tasks: Task[] }>('/tasks'),
    get: (id: string) => request<{ task: Task }>(`/tasks/${id}`),
    create: (data: {
      project_id: string;
      title: string;
      description?: string;
      priority?: string;
      assigned_to?: string | null;
      estimated_days: number;
      assigned_tech?: string[];
      user_id?: string | null;
    }) =>
      request<{ task: Task }>('/tasks', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    assign: (taskId: string, assignedTo: string | null, userId?: string | null) =>
      request<{ success: boolean }>(`/tasks/${taskId}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ assigned_to: assignedTo, user_id: userId ?? null }),
      }),
    complete: (taskId: string, completed: boolean, completedBy?: string) =>
      request<{ success: boolean }>(`/tasks/${taskId}/complete`, {
        method: 'PATCH',
        body: JSON.stringify({ completed, completed_by: completedBy }),
      }),
    updateStatus: (taskId: string, status: string, completedBy?: string | null) =>
      request<{ success: boolean; status: string; completed_by?: string | null; completed_at?: string | null }>(`/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status, completed_by: completedBy ?? null }),
      }),
    updatePriority: (taskId: string, priority: string, userId?: string | null) =>
      request<{ success: boolean; priority: string }>(`/tasks/${taskId}/priority`, {
        method: 'PATCH',
        body: JSON.stringify({ priority, user_id: userId ?? null }),
      }),
    updateSchedule: (taskId: string, data: { start_date: string | null; end_date: string | null; estimated_days?: number; user_id?: string | null }) =>
      request<{ success: boolean }>(`/tasks/${taskId}/schedule`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    updateQuality: (taskId: string, data: { acceptance_criteria?: TaskChecklistItem[]; definition_of_done?: TaskChecklistItem[]; user_id?: string | null }) =>
      request<{ task: Task }>(`/tasks/${taskId}/quality`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    addDependency: (taskId: string, dependsOnTaskId: string, userId?: string | null) =>
      request<{ success: boolean; already_exists?: boolean }>(`/tasks/${taskId}/dependencies`, {
        method: 'POST',
        body: JSON.stringify({ depends_on_task_id: dependsOnTaskId, user_id: userId ?? null }),
      }),
    removeDependency: (taskId: string, dependsOnTaskId: string, userId?: string | null) =>
      request<{ success: boolean }>(`/tasks/${taskId}/dependencies/${dependsOnTaskId}${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`, {
        method: 'DELETE',
      }),
    collaboration: (taskId: string) =>
      request<{ comments: TaskComment[]; attachments: TaskAttachment[]; activity: TaskActivity[] }>(`/tasks/${taskId}/collaboration`),
    addComment: (taskId: string, data: { user_id?: string | null; content: string; mentioned_user_ids?: string[] }) =>
      request<{ comment: TaskComment }>(`/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateComment: (taskId: string, commentId: string, data: { user_id?: string | null; content: string }) =>
      request<{ comment: TaskComment }>(`/tasks/${taskId}/comments/${commentId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    deleteComment: (taskId: string, commentId: string, userId?: string | null) =>
      request<{ success: boolean }>(`/tasks/${taskId}/comments/${commentId}`, {
        method: 'DELETE',
        body: JSON.stringify({ user_id: userId ?? null }),
      }),
    uploadAttachment: async (taskId: string, file: File, userId?: string | null) => {
      const formData = new FormData();
      formData.append('file', file);
      if (userId) formData.append('user_id', userId);
      const res = await fetch(`${BASE_URL}/tasks/${taskId}/attachments`, {
        method: 'POST',
        headers: await authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let message = `Request failed (${res.status})`;
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) message = parsed.error;
        } catch {
          if (body) message = body;
        }
        throw new Error(message);
      }
      return res.json() as Promise<{ attachment: TaskAttachment }>;
    },
  },
  time: {
    project: (projectId: string) =>
      request<{ entries: TimeEntry[]; tasks: TaskTimeSummary[]; totals: { actual_minutes: number; estimated_minutes: number; estimate_accuracy: number | null } }>(`/time/projects/${projectId}`),
    task: (taskId: string, userId?: string | null) =>
      request<{ entries: TimeEntry[]; active_timer: TimeEntry | null; total_minutes: number; estimate_accuracy: number | null }>(`/time/tasks/${taskId}${userId ? `?user_id=${encodeURIComponent(userId)}` : ''}`),
    startTimer: (taskId: string, data: { user_id?: string | null; note?: string }) =>
      request<{ entry: TimeEntry; already_running?: boolean }>(`/time/tasks/${taskId}/start`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    stopTimer: (taskId: string, userId?: string | null) =>
      request<{ entry: TimeEntry }>(`/time/tasks/${taskId}/stop`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId ?? null }),
      }),
    addManual: (taskId: string, data: { user_id?: string | null; minutes: number; note?: string; work_date?: string }) =>
      request<{ entry: TimeEntry }>(`/time/tasks/${taskId}/manual`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  portfolio: {
    roadmap: () =>
      request<{ projects: PortfolioProject[]; workload: PortfolioWorkload[] }>('/portfolio/roadmap'),
  },
  clientShares: {
    list: (projectId: string, actorId?: string | null) =>
      request<{ shares: ProjectClientShare[] }>(`/client/projects/${projectId}/shares${actorId ? `?actor_id=${encodeURIComponent(actorId)}` : ''}`),
    create: (projectId: string, data: { actor_id?: string | null; settings: ClientShareSettings }) =>
      request<{ share: ProjectClientShare }>(`/client/projects/${projectId}/shares`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (shareId: string, data: { actor_id?: string | null; settings?: ClientShareSettings; is_active?: boolean }) =>
      request<{ share: ProjectClientShare }>(`/client/shares/${shareId}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    getPublic: (token: string) =>
      request<ClientPortalPayload>(`/client/share/${token}`),
    addComment: (token: string, data: { author_name: string; content: string }) =>
      request<{ comment: ClientPortalComment }>(`/client/share/${token}/comments`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  search: {
    run: (filters: SearchFilters) => {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '' || value === false) return;
        params.set(key, String(value));
      });
      return request<{ results: SearchResult[]; total: number }>(`/search?${params.toString()}`);
    },
  },
  users: {
    list: () => request<{ users: User[] }>('/users'),
    getProfile: (id: string) => request<{ profile: ProfileData }>(`/users/${id}/profile`),
    update: (id: string, data: { full_name?: string; phone?: string; experience_summary?: string; github_url?: string; linkedin_url?: string; x_url?: string; skills?: string[]; job_title?: string }) =>
      request<{ success: boolean }>(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    uploadCV: async (id: string, file: File) => {
      const formData = new FormData();
      formData.append('cv', file);
      const res = await fetch(`${BASE_URL}/users/${id}/cv`, {
        method: 'POST',
        headers: await authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let message = `Request failed (${res.status})`;
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) message = parsed.error;
        } catch {
          if (body) message = body;
        }
        throw new Error(message);
      }
      return res.json() as Promise<{ success: boolean; skills: string[]; experience_summary: string }>;
    },
    uploadAvatar: async (id: string, file: File) => {
      const formData = new FormData();
      formData.append('avatar', file);
      const res = await fetch(`${BASE_URL}/users/${id}/avatar`, {
        method: 'POST',
        headers: await authHeaders(),
        body: formData,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        let message = `Request failed (${res.status})`;
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) message = parsed.error;
        } catch {
          if (body) message = body;
        }
        throw new Error(message);
      }
      return res.json() as Promise<{ success: boolean; avatar_url: string }>;
    },
  },
  ai: {
    generate: (data: {
      name: string;
      description: string;
      duration: string;
      duration_unit: string;
      team_members: string[];
      expand_description?: boolean;
      template_id?: string;
      complexity?: 'simple' | 'standard' | 'advanced';
      budget?: number;
      deadline_strictness?: 'flexible' | 'fixed';
      preferred_tech?: string[];
      excluded_tech?: string[];
    }) =>
      request<PlanPreviewResult>('/ai/generate', {
        method: 'POST',
        body: JSON.stringify(data),
      }, 210_000),

    save: (data: {
      projectId: string;
      schedule: GeneratedSchedule;
      name: string;
      savedDescription: string;
      durationWeeks: number;
      databaseMembers: string[];
    }) =>
      request<{ success: boolean; project_id: string }>('/ai/save', {
        method: 'POST',
        body: JSON.stringify(data),
      }, 30_000),

    improve: (data: {
      currentSchedule: GeneratedSchedule;
      issues: QualityIssue[];
      name: string;
      description: string;
      duration: string;
      duration_unit: string;
      team_members: string[];
      databaseMembers: string[];
      totalDays: number;
    }) =>
      request<PlanPreviewResult>('/ai/improve', {
        method: 'POST',
        body: JSON.stringify(data),
      }, 120_000),

    refine: (data: {
      currentSchedule: GeneratedSchedule;
      userMessage: string;
      conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
      name: string;
      description: string;
      duration: string;
      duration_unit: string;
      team_members: string[];
      databaseMembers: string[];
      totalDays: number;
    }) =>
      request<RefinementResult>('/ai/refine', {
        method: 'POST',
        body: JSON.stringify(data),
      }, 120_000),

    chat: (data: { message: string; context?: string }) =>
      request<{ response: string }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  templates: {
    list: () => request<{ templates: ProjectTemplate[] }>('/templates'),
    saveFromProject: (projectId: string, data: { name?: string; created_by?: string | null }) =>
      request<{ template: ProjectTemplate }>(`/templates/from-project/${projectId}`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    duplicate: (id: string, createdBy?: string | null) =>
      request<{ template: ProjectTemplate }>(`/templates/${id}/duplicate`, {
        method: 'POST',
        body: JSON.stringify({ created_by: createdBy ?? null }),
      }),
  },
  notifications: {
    list: (userId: string) =>
      request<{ notifications: AppNotification[]; unread_count: number; preferences: NotificationPreferences }>(`/notifications/${userId}`),
    markRead: (id: string, read = true) =>
      request<{ success: boolean }>(`/notifications/${id}/read`, {
        method: 'PATCH',
        body: JSON.stringify({ read }),
      }),
    markAllRead: (userId: string) =>
      request<{ success: boolean }>(`/notifications/${userId}/read-all`, { method: 'PATCH' }),
    updatePreferences: (userId: string, preferences: Partial<NotificationPreferences>) =>
      request<{ preferences: NotificationPreferences }>(`/notifications/${userId}/preferences`, {
        method: 'PATCH',
        body: JSON.stringify(preferences),
      }),
  },
  github: {
    getRepository: (projectId: string) =>
      request<{ repository: GitHubRepository | null }>(`/github/projects/${projectId}/repository`),
    connectRepository: (projectId: string, data: { repo_url: string; connected_by?: string | null }) =>
      request<{ repository: GitHubRepository }>(`/github/projects/${projectId}/repository`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    disconnectRepository: (projectId: string, actorId?: string | null) =>
      request<{ success: boolean }>(`/github/projects/${projectId}/repository${actorId ? `?actor_id=${encodeURIComponent(actorId)}` : ''}`, { method: 'DELETE' }),
    getTaskLinks: (taskId: string) =>
      request<{ repository: GitHubRepository | null; links: GitHubTaskLink[] }>(`/github/tasks/${taskId}`),
    addTaskLink: (taskId: string, data: { issue_number?: number | string | null; branch_name?: string | null; pull_request_number?: number | string | null; created_by?: string | null }) =>
      request<{ link: GitHubTaskLink }>(`/github/tasks/${taskId}/links`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    removeTaskLink: (taskId: string, linkId: string, actorId?: string | null) =>
      request<{ success: boolean }>(`/github/tasks/${taskId}/links/${linkId}${actorId ? `?actor_id=${encodeURIComponent(actorId)}` : ''}`, { method: 'DELETE' }),
    createIssueFromTask: (taskId: string, createdBy?: string | null) =>
      request<{ issue: { number: number; html_url: string }; link: GitHubTaskLink }>(`/github/tasks/${taskId}/create-issue`, {
        method: 'POST',
        body: JSON.stringify({ created_by: createdBy ?? null }),
      }),
    importIssues: (projectId: string, createdBy?: string | null) =>
      request<{ tasks: Task[] }>(`/github/projects/${projectId}/import-issues`, {
        method: 'POST',
        body: JSON.stringify({ created_by: createdBy ?? null }),
      }),
    syncTask: (taskId: string, userId?: string | null) =>
      request<{ commits: GitHubCommit[]; pull_requests: GitHubPullRequest[]; links: GitHubTaskLink[] }>(`/github/tasks/${taskId}/sync`, {
        method: 'POST',
        body: JSON.stringify({ user_id: userId ?? null }),
      }),
  },
  calendar: {
    status: (userId: string) =>
      request<{ connections: CalendarConnection[]; events: TaskCalendarEvent[] }>(`/calendar/${userId}/status`),
    googleAuthUrl: (userId: string, redirectUri: string) =>
      request<{ auth_url: string }>(`/calendar/google/auth-url?user_id=${encodeURIComponent(userId)}&redirect_uri=${encodeURIComponent(redirectUri)}`),
    connectGoogle: (data: { user_id: string; code: string; redirect_uri: string; timezone?: string }) =>
      request<{ connection: CalendarConnection }>('/calendar/google/connect', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateSettings: (userId: string, data: Partial<Pick<CalendarConnection, 'provider' | 'calendar_id' | 'calendar_name' | 'timezone' | 'sync_enabled' | 'create_work_blocks'>>) =>
      request<{ connection: CalendarConnection }>(`/calendar/${userId}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    disconnect: (userId: string, provider: 'google' | 'outlook') =>
      request<{ success: boolean }>(`/calendar/${userId}/${provider}`, { method: 'DELETE' }),
    syncTask: (taskId: string, data: { user_id: string; event_type?: 'due_date' | 'work_block'; create_work_block?: boolean }) =>
      request<{ events: TaskCalendarEvent[] }>(`/calendar/tasks/${taskId}/sync`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    disableTask: (taskId: string, data: { user_id: string; event_type?: 'due_date' | 'work_block' }) =>
      request<{ success: boolean }>(`/calendar/tasks/${taskId}/disable`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
  },
  slack: {
    getProject: (projectId: string) =>
      request<{ integration: SlackIntegration | null }>(`/slack/projects/${projectId}`),
    connectProject: (projectId: string, data: { webhook_url: string; channel_name?: string; connected_by?: string | null }) =>
      request<{ integration: SlackIntegration }>(`/slack/projects/${projectId}/connect`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateProject: (projectId: string, data: Partial<Pick<SlackIntegration, 'channel_name' | 'assignment_notifications' | 'overdue_alerts' | 'project_risk_alerts' | 'mention_notifications' | 'summary_notifications' | 'summary_frequency'>> & { actor_id?: string | null }) =>
      request<{ integration: SlackIntegration }>(`/slack/projects/${projectId}/preferences`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    disconnectProject: (projectId: string, actorId?: string | null) =>
      request<{ success: boolean }>(`/slack/projects/${projectId}${actorId ? `?actor_id=${encodeURIComponent(actorId)}` : ''}`, { method: 'DELETE' }),
    sendSummary: (projectId: string, actorId?: string | null) =>
      request<{ sent: boolean; reason?: string }>(`/slack/projects/${projectId}/summary`, {
        method: 'POST',
        body: JSON.stringify({ actor_id: actorId ?? null }),
      }),
    testProject: (projectId: string, actorId?: string | null) =>
      request<{ success: boolean }>(`/slack/projects/${projectId}/test`, {
        method: 'POST',
        body: JSON.stringify({ actor_id: actorId ?? null }),
      }),
  },
  reports: {
    generate: (projectId: string) =>
      request<WeeklyReport>(`/reports/projects/${projectId}/generate`, { method: 'POST' }, 90_000),
    sendSlack: (projectId: string, report: WeeklyReport) =>
      request<{ sent: boolean }>(`/reports/projects/${projectId}/send-slack`, {
        method: 'POST',
        body: JSON.stringify({ report }),
      }),
  },
  health: {
    get: (projectId: string) =>
      request<ProjectHealthReport>(`/health/projects/${projectId}`),
    summary: (projectId: string, health: ProjectHealthReport) =>
      request<{ summary: string }>(`/health/projects/${projectId}/summary`, {
        method: 'POST',
        body: JSON.stringify({ health }),
      }, 60_000),
  },
  imports: {
    exportCsv: (projectId: string, format: 'jira' | 'linear') =>
      `${BASE_URL}/imports/projects/${projectId}/export?format=${format}`,
    preview: (projectId: string, data: { source: 'jira' | 'linear'; csv: string }) =>
      request<{ source: string; tasks: ImportRow[]; total: number }>(`/imports/projects/${projectId}/preview`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    import: (projectId: string, data: { source: 'jira' | 'linear'; tasks: ImportRow[]; created_by?: string | null }) =>
      request<{ imported: number; skipped: number; tasks: Task[] }>(`/imports/projects/${projectId}/import`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    analyze: (projectId: string, task_ids: string[]) =>
      request<{ analysis: ImportAnalysis; task_count: number }>(`/imports/projects/${projectId}/analyze`, {
        method: 'POST',
        body: JSON.stringify({ task_ids }),
      }, 60_000),
  },
};
