import { useState, useEffect, useRef, type CSSProperties } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { ArrowLeft, Calendar as CalendarIcon, ChevronDown, Sparkles, UserPlus, UserMinus, Users, CheckCircle2, Circle, Clock, Tag, LayoutGrid, List, Filter, AlertTriangle, BookmarkPlus, Download, Github, Link2, UploadCloud, CalendarPlus, MessageCircle, Timer, Share2, Copy, EyeOff } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api, type Project, type Task, type ProjectMember, type User, type GitHubRepository, type CalendarConnection, type TaskCalendarEvent, type SlackIntegration, type TimeEntry, type TaskTimeSummary, type ProjectPermissions, type ProjectInvitation, type ProjectRole, type ProjectClientShare, type ClientShareSettings } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { TaskDetailPanel } from "../components/TaskDetailPanel";
import { AddTaskForm } from "../components/AddTaskForm";
import { buildDependencyAwareSchedule } from "../lib/schedule";
import { exportProject, type ExportFormat } from "../lib/projectExport";
import { riskStyle, scoreProjectHealth } from "../lib/riskScoring";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" });
}

function getInitials(name: string | null, email: string): string {
  if (name) return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

const GRADIENTS = [
  "from-purple-600 to-purple-800",
  "from-purple-600 to-pink-600",
  "from-green-600 to-emerald-600",
  "from-orange-600 to-red-600",
  "from-indigo-600 to-purple-600",
];

const PRIORITY_COLORS: Record<string, string> = {
  High: "border-red-500/40 bg-red-900/30 text-red-300",
  Medium: "border-yellow-500/40 bg-yellow-900/30 text-yellow-300",
  Low: "border-green-500/40 bg-green-900/30 text-green-300",
};

const KANBAN_COLUMNS = [
  { label: "Backlog", status: "Backlog", dot: "bg-gray-400" },
  { label: "To Do", status: "To Do", dot: "bg-sky-400" },
  { label: "In Progress", status: "In Progress", dot: "bg-purple-400" },
  { label: "Review", status: "In Review", dot: "bg-amber-400" },
  { label: "Done", status: "Done", dot: "bg-green-400" },
] as const;

type ProjectView = "list" | "kanban";

const DEFAULT_CLIENT_SETTINGS: ClientShareSettings = {
  show_tasks: true,
  show_milestones: true,
  show_completed_tasks: true,
  show_current_tasks: true,
  show_upcoming_tasks: true,
  show_internal_risks: false,
  allow_client_comments: false,
  brand_label: "",
};

function recomputeBlockers(tasks: Task[]): Task[] {
  const statusById = new Map(tasks.map((task) => [task.id, task.status]));
  const titleById = new Map(tasks.map((task) => [task.id, task.title]));
  return tasks.map((task) => {
    const blockedBy = (task.blocked_by ?? []).map((item) => ({
      ...item,
      title: titleById.get(item.id) ?? item.title,
      status: statusById.get(item.id) ?? item.status,
    }));
    const unlocks = (task.unlocks ?? []).map((item) => ({
      ...item,
      title: titleById.get(item.id) ?? item.title,
      status: statusById.get(item.id) ?? item.status,
    }));
    const blockingCount = blockedBy.filter((item) => item.status !== "Done").length;
    return {
      ...task,
      blocked_by: blockedBy,
      unlocks,
      blocking_count: blockingCount,
      is_blocked: blockingCount > 0,
    };
  });
}

function blockedWarning(task: Task): string {
  const blockers = (task.blocked_by ?? []).filter((item) => item.status !== "Done");
  return `${task.title} is blocked by: ${blockers.map((item) => item.title).join(", ")}. Continue anyway?`;
}

function incompleteQualityCount(task: Task): number {
  return [
    ...(task.acceptance_criteria ?? []),
    ...(task.definition_of_done ?? []),
  ].filter((item) => !item.checked).length;
}

function qualityWarning(task: Task): string {
  const count = incompleteQualityCount(task);
  return `${task.title} has ${count} unchecked acceptance/done check${count === 1 ? "" : "s"}. Continue anyway?`;
}

function statusLabel(status: string): string {
  return status === "In Review" ? "Review" : status;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function weekLabel(iso: string | null, locale: string): string {
  const date = iso ? new Date(iso) : new Date();
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date);
  monday.setDate(diff);
  return monday.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}

function translateProjectRisk(t: TFunction, text: string): string {
  const countMatch = text.match(/^(\d+) (overdue|blocked) tasks?\.$/);
  if (countMatch) return t(`detail.health.${countMatch[2]}`, { count: Number(countMatch[1]) });
  const unownedMatch = text.match(/^(\d+) tasks? (?:has|have) no owner\.$/);
  if (unownedMatch) return t("detail.health.unowned", { count: Number(unownedMatch[1]) });
  const keys: Record<string, string> = {
    "Open estimates exceed team timeline capacity.": "capacityReason", "More than 40% of open tasks are high priority.": "priorityReason", "Most tasks have no dependencies.": "dependenciesReason", "Project is currently healthy.": "healthyReason",
    "Review overdue work and reset dates or owners.": "overdueAction", "Clear blockers before starting more work.": "blockedAction", "Assign owners for unowned tasks.": "unownedAction", "Reduce scope, extend timeline, or add capacity.": "capacityAction", "Separate true critical-path work from normal priority work.": "priorityAction", "Add key dependencies for setup, integration, testing, and release.": "dependenciesAction", "Keep updating task status and blockers.": "healthyAction",
  };
  return keys[text] ? t(`detail.health.${keys[text]}`) : text;
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function TaskDetails() {
  const { taskId } = useParams<{ taskId: string }>();
  const location = useLocation();
  const { session } = useAuth();
  const { t, i18n } = useTranslation("tasks");
  const locale = i18n.language === "ar" ? "ar-SA" : "en-US";
  const currentUserId = session?.user.id;

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [permissions, setPermissions] = useState<ProjectPermissions | null>(null);
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [clientShares, setClientShares] = useState<ProjectClientShare[]>([]);
  const [clientShareSettings, setClientShareSettings] = useState<ClientShareSettings>(DEFAULT_CLIENT_SETTINGS);
  const [clientShareLoading, setClientShareLoading] = useState(false);
  const [clientShareError, setClientShareError] = useState<string | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("Member");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [assignDropdownId, setAssignDropdownId] = useState<string | null>(null);
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [view, setView] = useState<ProjectView>("list");
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [weeklyReport, setWeeklyReport] = useState<string | null>(null);
  const [weeklyReportLoading, setWeeklyReportLoading] = useState(false);
  const [githubRepo, setGithubRepo] = useState<GitHubRepository | null>(null);
  const [githubRepoInput, setGithubRepoInput] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [calendarConnection, setCalendarConnection] = useState<CalendarConnection | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<TaskCalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [slackIntegration, setSlackIntegration] = useState<SlackIntegration | null>(null);
  const [slackWebhookInput, setSlackWebhookInput] = useState("");
  const [slackChannelInput, setSlackChannelInput] = useState("");
  const [slackLoading, setSlackLoading] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [timeTasks, setTimeTasks] = useState<TaskTimeSummary[]>([]);
  const [timeTotals, setTimeTotals] = useState<{ actual_minutes: number; estimated_minutes: number; estimate_accuracy: number | null } | null>(null);
  const [timeError, setTimeError] = useState<string | null>(null);
  const [taskPanelWidth, setTaskPanelWidth] = useState(440);
  const panelDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const [filters, setFilters] = useState({
    assignee: "all",
    priority: "all",
    status: "all",
    overdueOnly: false,
  });

  useEffect(() => {
    if (!taskId) return;
    Promise.all([api.projects.get(taskId, currentUserId), api.users.list()])
      .then(([pd, ud]) => {
        setProject(pd.project);
        setTasks(pd.tasks);
        const focusedTaskId = new URLSearchParams(location.search).get("task");
        if (focusedTaskId && pd.tasks.some((task) => task.id === focusedTaskId)) setSelectedTaskId(focusedTaskId);
        setMembers(pd.members ?? []);
        setPermissions(pd.permissions ?? null);
        setInvitations(pd.invitations ?? []);
        setAllUsers(ud.users);
        api.github.getRepository(taskId)
          .then((data) => setGithubRepo(data.repository))
          .catch(() => setGithubError("GitHub integration is not configured yet."));
        if (currentUserId) {
          api.calendar.status(currentUserId)
            .then((data) => {
              setCalendarConnection(data.connections.find((item) => item.provider === "google") ?? null);
              setCalendarEvents(data.events);
            })
            .catch(() => setCalendarError("Calendar sync is not configured yet."));
        }
        api.slack.getProject(taskId)
          .then((data) => {
            setSlackIntegration(data.integration);
            setSlackChannelInput(data.integration?.channel_name ?? "");
          })
          .catch(() => setSlackError("Slack integration is not configured yet."));
        api.time.project(taskId)
          .then((data) => {
            setTimeEntries(data.entries);
            setTimeTasks(data.tasks);
            setTimeTotals(data.totals);
          })
          .catch(() => setTimeError("Time tracking is not available yet."));
        if (pd.permissions?.can_manage_project) {
          api.clientShares.list(taskId, currentUserId)
            .then((data) => {
              setClientShares(data.shares);
              const active = data.shares.find((share) => share.is_active);
              if (active) setClientShareSettings({ ...DEFAULT_CLIENT_SETTINGS, ...active.settings });
            })
            .catch(() => setClientShareError("Client sharing is not configured yet."));
        }
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [taskId, currentUserId, location.search]);

  const scheduleMap = buildDependencyAwareSchedule(tasks);
  const doneTasks = tasks.filter((t) => t.status === "Done").length;
  const progress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const blockedTasks = tasks.filter((t) => t.is_blocked);
  const todayStart = startOfToday();
  const projectRisk = project ? scoreProjectHealth(project, tasks, members, scheduleMap) : null;
  const weeklyTimesheet = Array.from(timeEntries.reduce((map, entry) => {
    const key = weekLabel(entry.start_time, locale);
    map.set(key, (map.get(key) ?? 0) + Number(entry.minutes || 0));
    return map;
  }, new Map<string, number>()).entries()).slice(0, 6);
  const canManageMembers = Boolean(permissions?.can_manage_members);
  const canManageIntegrations = Boolean(permissions?.can_manage_integrations);
  const canManageProject = Boolean(permissions?.can_manage_project);
  const canEditTasks = Boolean(permissions?.can_edit_tasks);
  const canExportProject = Boolean(permissions?.can_export);
  const canViewCapacity = permissions?.can_view_capacity !== false;
  const roleLabel = permissions?.role ? t(`detail.roles.${permissions.role}`) : t("detail.noRole");
  const activeClientShare = clientShares.find((share) => share.is_active) ?? null;
  const clientShareUrl = activeClientShare ? `${window.location.origin}/client/${activeClientShare.token}` : "";

  const isOverdue = (task: Task) => {
    if (task.status === "Done") return false;
    const sched = scheduleMap.get(task.id);
    if (!sched) return false;
    return sched.end < todayStart;
  };

  const filteredTasks = tasks.filter((task) => {
    if (filters.assignee !== "all" && (task.assigned_to ?? "unassigned") !== filters.assignee) return false;
    if (filters.priority !== "all" && task.priority !== filters.priority) return false;
    if (filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.overdueOnly && !isOverdue(task)) return false;
    return true;
  });

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2400);
  };

  const startPanelResize = (clientX: number) => {
    panelDragRef.current = { startX: clientX, startWidth: taskPanelWidth };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!panelDragRef.current) return;
      const x = ev instanceof MouseEvent ? ev.clientX : ev.touches[0]?.clientX;
      if (x === undefined) return;
      const delta = panelDragRef.current.startX - x;
      const maxWidth = Math.min(920, Math.round(window.innerWidth * 0.68));
      setTaskPanelWidth(Math.max(360, Math.min(maxWidth, panelDragRef.current.startWidth + delta)));
    };
    const onUp = () => {
      panelDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  };

  const connectGithubRepo = async () => {
    if (!taskId || !githubRepoInput.trim() || githubLoading || !canManageIntegrations) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      const { repository } = await api.github.connectRepository(taskId, {
        repo_url: githubRepoInput.trim(),
        connected_by: currentUserId ?? null,
      });
      setGithubRepo(repository);
      setGithubRepoInput("");
      showToast("GitHub repository connected");
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not connect GitHub repository");
    } finally {
      setGithubLoading(false);
    }
  };

  const disconnectGithubRepo = async () => {
    if (!taskId || githubLoading || !canManageIntegrations) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      await api.github.disconnectRepository(taskId, currentUserId);
      setGithubRepo(null);
      showToast("GitHub repository disconnected");
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not disconnect repository");
    } finally {
      setGithubLoading(false);
    }
  };

  const importGithubIssues = async () => {
    if (!taskId || githubLoading || !canEditTasks) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      const { tasks: imported } = await api.github.importIssues(taskId, currentUserId ?? null);
      setTasks((current) => recomputeBlockers([...current, ...imported]));
      showToast(`Imported ${imported.length} GitHub issue${imported.length === 1 ? "" : "s"}`);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not import GitHub issues");
    } finally {
      setGithubLoading(false);
    }
  };

  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== "calendar-oauth") return;
      if (!currentUserId) return;
      if (event.data.error) {
        setCalendarError("Calendar connection was cancelled.");
        return;
      }
      if (!event.data.code) return;
      setCalendarLoading(true);
      setCalendarError(null);
      try {
        const redirectUri = `${window.location.origin}/calendar/callback`;
        const { connection } = await api.calendar.connectGoogle({
          user_id: currentUserId,
          code: event.data.code,
          redirect_uri: redirectUri,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        setCalendarConnection(connection);
        showToast("Google Calendar connected");
      } catch (err) {
        setCalendarError(err instanceof Error ? err.message : "Could not connect Google Calendar");
      } finally {
        setCalendarLoading(false);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [currentUserId]);

  const connectGoogleCalendar = async () => {
    if (!currentUserId || calendarLoading) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const redirectUri = `${window.location.origin}/calendar/callback`;
      const { auth_url } = await api.calendar.googleAuthUrl(currentUserId, redirectUri);
      window.open(auth_url, "google-calendar-connect", "width=520,height=720");
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Could not start Google Calendar connection");
    } finally {
      setCalendarLoading(false);
    }
  };

  const updateCalendarSettings = async (patch: Partial<CalendarConnection>) => {
    if (!currentUserId || !calendarConnection || !canManageIntegrations) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const { connection } = await api.calendar.updateSettings(currentUserId, { provider: "google", ...patch });
      setCalendarConnection(connection);
      showToast("Calendar settings updated");
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Could not update calendar settings");
    } finally {
      setCalendarLoading(false);
    }
  };

  const disconnectCalendar = async () => {
    if (!currentUserId || calendarLoading || !canManageIntegrations) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      await api.calendar.disconnect(currentUserId, "google");
      setCalendarConnection(null);
      setCalendarEvents([]);
      showToast("Calendar disconnected");
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Could not disconnect calendar");
    } finally {
      setCalendarLoading(false);
    }
  };

  const connectSlack = async () => {
    if (!taskId || !slackWebhookInput.trim() || slackLoading || !canManageIntegrations) return;
    setSlackLoading(true);
    setSlackError(null);
    try {
      const { integration } = await api.slack.connectProject(taskId, {
        webhook_url: slackWebhookInput.trim(),
        channel_name: slackChannelInput.trim(),
        connected_by: currentUserId ?? null,
      });
      setSlackIntegration(integration);
      setSlackWebhookInput("");
      setSlackChannelInput(integration.channel_name ?? "");
      showToast("Slack connected");
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : "Could not connect Slack");
    } finally {
      setSlackLoading(false);
    }
  };

  const updateSlackSettings = async (patch: Partial<SlackIntegration>) => {
    if (!taskId || !slackIntegration || slackLoading || !canManageIntegrations) return;
    setSlackLoading(true);
    setSlackError(null);
    try {
      const { integration } = await api.slack.updateProject(taskId, { ...patch, actor_id: currentUserId ?? null });
      setSlackIntegration(integration);
      setSlackChannelInput(integration.channel_name ?? "");
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : "Could not update Slack settings");
    } finally {
      setSlackLoading(false);
    }
  };

  const disconnectSlack = async () => {
    if (!taskId || slackLoading || !canManageIntegrations) return;
    setSlackLoading(true);
    setSlackError(null);
    try {
      await api.slack.disconnectProject(taskId, currentUserId);
      setSlackIntegration(null);
      showToast("Slack disconnected");
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : "Could not disconnect Slack");
    } finally {
      setSlackLoading(false);
    }
  };

  const sendSlackSummary = async () => {
    if (!taskId || slackLoading || !canManageIntegrations) return;
    setSlackLoading(true);
    setSlackError(null);
    try {
      const result = await api.slack.sendSummary(taskId, currentUserId);
      showToast(result.sent ? "Slack summary sent" : result.reason ?? "Slack summary skipped");
    } catch (err) {
      setSlackError(err instanceof Error ? err.message : "Could not send Slack summary");
    } finally {
      setSlackLoading(false);
    }
  };

  const refreshProjectTime = async () => {
    if (!taskId) return;
    try {
      const data = await api.time.project(taskId);
      setTimeEntries(data.entries);
      setTimeTasks(data.tasks);
      setTimeTotals(data.totals);
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "Could not refresh time tracking");
    }
  };

  const exportTimesheet = (format: "csv" | "xlsx") => {
    if (!project) return;
    const rows = [
      ["Task", "Status", "Estimated hours", "Actual hours", "Accuracy"],
      ...timeTasks.map((task) => [
        task.title,
        task.status,
        (task.estimated_minutes / 60).toFixed(2),
        (task.actual_minutes / 60).toFixed(2),
        task.estimate_accuracy === null ? "" : `${task.estimate_accuracy}%`,
      ]),
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadText(`${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-timesheet.${format === "csv" ? "csv" : "xls"}`, csv, format === "csv" ? "text/csv;charset=utf-8" : "application/vnd.ms-excel");
  };

  const handleAddMember = async (userId: string) => {
    if (!taskId) return;
    setMemberError(null);
    setMemberActionId(userId);
    try {
      await api.projects.addMember(taskId, userId, inviteRole, currentUserId);
      const u = allUsers.find((x) => x.id === userId);
      if (u) setMembers((p) => [...p.filter((member) => member.user_id !== userId), { user_id: userId, role: inviteRole, id: u.id, email: u.email, full_name: u.full_name, avatar_url: u.avatar_url }]);
      setShowAddMember(false);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not add member");
    } finally { setMemberActionId(null); }
  };

  const handleInviteMember = async () => {
    if (!taskId || !inviteEmail.trim()) return;
    setMemberActionId("invite");
    setMemberError(null);
    try {
      const result = await api.projects.inviteMember(taskId, {
        email: inviteEmail.trim(),
        role: inviteRole,
        actor_id: currentUserId ?? null,
      });
      if (result.assigned && result.user) {
        const invitedUser = result.user;
        setMembers((current) => [
          ...current.filter((member) => member.user_id !== invitedUser.id),
          { user_id: invitedUser.id, role: result.role ?? inviteRole, id: invitedUser.id, email: invitedUser.email, full_name: invitedUser.full_name, avatar_url: invitedUser.avatar_url },
        ]);
        showToast("Member added");
      } else if (result.invitation) {
        setInvitations((current) => [...current.filter((item) => item.id !== result.invitation!.id), result.invitation!]);
        showToast("Invitation saved");
      }
      setInviteEmail("");
      setShowAddMember(false);
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not invite member");
    } finally {
      setMemberActionId(null);
    }
  };

  const handleChangeMemberRole = async (userId: string, role: ProjectRole) => {
    if (!taskId) return;
    setMemberActionId(userId);
    setMemberError(null);
    try {
      await api.projects.updateMemberRole(taskId, userId, role, currentUserId);
      setMembers((current) => current.map((member) => member.user_id === userId ? { ...member, role } : member));
      showToast("Role updated");
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not update role");
    } finally {
      setMemberActionId(null);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!taskId) return;
    setMemberError(null);
    setMemberActionId(userId);
    try {
      await api.projects.removeMember(taskId, userId, currentUserId);
      setMembers((p) => p.filter((m) => m.user_id !== userId));
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : "Could not remove member");
    } finally { setMemberActionId(null); }
  };

  const handleAssignTask = async (tid: string, userId: string | null) => {
    if (!canEditTasks) return;
    setAssigningTaskId(tid);
    try {
      await api.tasks.assign(tid, userId, currentUserId);
      setTasks((p) => p.map((t) => t.id === tid ? { ...t, assigned_to: userId, latest_activity_at: new Date().toISOString() } : t));
    } catch { /* silent */ } finally { setAssigningTaskId(null); setAssignDropdownId(null); }
  };

  const handleCompleteTask = async (tid: string, completed: boolean) => {
    if (!canEditTasks) return;
    const target = tasks.find((t) => t.id === tid);
    if (completed && target?.is_blocked && !window.confirm(blockedWarning(target))) return;
    if (completed && target && incompleteQualityCount(target) > 0 && !window.confirm(qualityWarning(target))) return;
    const prev = tasks;
    setTasks((p) => recomputeBlockers(p.map((t) => t.id === tid ? {
      ...t,
      status: completed ? "Done" : "To Do",
      completed_by: completed ? (currentUserId ?? null) : null,
      completed_at: completed ? new Date().toISOString() : null,
      completer_name: completed ? (session?.user.user_metadata?.full_name ?? session?.user.email ?? null) : null,
      latest_activity_at: new Date().toISOString(),
    } : t)));
    try {
      await api.tasks.complete(tid, completed, currentUserId);
    } catch (err) {
      setTasks(prev);
      console.error("Task completion error:", err instanceof Error ? err.message : err);
      setCompletionError("Failed to update task. Please try again.");
      setTimeout(() => setCompletionError(null), 4000);
    }
  };

  const handleTaskUpdated = (updated: Task) => {
    setTasks((p) => recomputeBlockers(p.map((t) => (t.id === updated.id ? updated : t))));
  };

  const handleStatusChange = async (tid: string, nextStatus: string) => {
    const task = tasks.find((t) => t.id === tid);
    if (!task || task.status === nextStatus || !canEditTasks) return;
    if ((nextStatus === "In Progress" || nextStatus === "Done") && task.is_blocked && !window.confirm(blockedWarning(task))) {
      setDraggingTaskId(null);
      setDragOverStatus(null);
      return;
    }
    if (nextStatus === "Done" && incompleteQualityCount(task) > 0 && !window.confirm(qualityWarning(task))) {
      setDraggingTaskId(null);
      setDragOverStatus(null);
      return;
    }

    const prev = tasks;
    const nextCompletedAt = nextStatus === "Done" ? new Date().toISOString() : null;
    const nextCompletedBy = nextStatus === "Done" ? (currentUserId ?? null) : null;
    const nextCompleterName = nextStatus === "Done" ? (session?.user.user_metadata?.full_name ?? session?.user.email ?? null) : null;

    setTasks((p) => recomputeBlockers(
      p.map((t) =>
        t.id === tid
          ? {
              ...t,
              status: nextStatus,
              completed_at: nextCompletedAt,
              completed_by: nextCompletedBy,
              completer_name: nextCompleterName,
            }
          : t
      )
    )
    );

    try {
      const result = await api.tasks.updateStatus(tid, nextStatus, currentUserId);
      setTasks((p) => recomputeBlockers(
        p.map((t) =>
          t.id === tid
            ? {
                ...t,
                status: result.status,
                completed_at: result.completed_at ?? null,
                completed_by: result.completed_by ?? null,
                completer_name: result.status === "Done" ? nextCompleterName : null,
                latest_activity_at: new Date().toISOString(),
              }
            : t
        )
      )
      );
      showToast(`Moved to ${statusLabel(result.status)}`);
    } catch (err) {
      setTasks(prev);
      setCompletionError(err instanceof Error ? err.message : "Failed to update task status");
      setTimeout(() => setCompletionError(null), 4000);
    } finally {
      setDraggingTaskId(null);
      setDragOverStatus(null);
    }
  };

  const handleTaskCreated = (task: Task) => {
    setTasks((p) => [...p, task]);
  };

  const handleAddDependency = async (targetTaskId: string, blockerTaskId: string) => {
    if (!canEditTasks) return;
    await api.tasks.addDependency(targetTaskId, blockerTaskId, currentUserId);
    setTasks((current) => {
      const target = current.find((task) => task.id === targetTaskId);
      const blocker = current.find((task) => task.id === blockerTaskId);
      if (!target || !blocker) return current;
      return recomputeBlockers(current.map((task) => {
        if (task.id === targetTaskId) {
          const exists = (task.blocked_by ?? []).some((item) => item.id === blockerTaskId);
          return exists ? task : { ...task, blocked_by: [...(task.blocked_by ?? []), { id: blocker.id, title: blocker.title, status: blocker.status }] };
        }
        if (task.id === blockerTaskId) {
          const exists = (task.unlocks ?? []).some((item) => item.id === targetTaskId);
          return exists ? task : { ...task, unlocks: [...(task.unlocks ?? []), { id: target.id, title: target.title, status: target.status }] };
        }
        return task;
      }));
    });
    showToast("Blocker added");
  };

  const handleRemoveDependency = async (targetTaskId: string, blockerTaskId: string) => {
    if (!canEditTasks) return;
    await api.tasks.removeDependency(targetTaskId, blockerTaskId, currentUserId);
    setTasks((current) => recomputeBlockers(current.map((task) => {
      if (task.id === targetTaskId) {
        return { ...task, blocked_by: (task.blocked_by ?? []).filter((item) => item.id !== blockerTaskId) };
      }
      if (task.id === blockerTaskId) {
        return { ...task, unlocks: (task.unlocks ?? []).filter((item) => item.id !== targetTaskId) };
      }
      return task;
    })));
    showToast("Blocker removed");
  };

  const handleSaveTemplate = async () => {
    if (!project || savingTemplate || !canManageMembers) return;
    const name = window.prompt("Template name", `${project.name} Template`);
    if (name === null) return;

    setSavingTemplate(true);
    try {
      await api.templates.saveFromProject(project.id, {
        name: name.trim() || `${project.name} Template`,
        created_by: currentUserId ?? null,
      });
      showToast("Template saved");
    } catch (err) {
      setCompletionError(err instanceof Error ? err.message : "Failed to save template");
      setTimeout(() => setCompletionError(null), 4000);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleExport = (format: ExportFormat) => {
    if (!project || !canExportProject) return;
    exportProject({ project, tasks, members, scheduleMap }, format);
    setShowExportMenu(false);
    showToast(`Exported ${format.toUpperCase()}`);
  };

  const createOrUpdateClientShare = async () => {
    if (!taskId || !canManageProject) return;
    setClientShareLoading(true);
    setClientShareError(null);
    try {
      if (activeClientShare) {
        const { share } = await api.clientShares.update(activeClientShare.id, {
          actor_id: currentUserId ?? null,
          settings: clientShareSettings,
        });
        setClientShares((current) => current.map((item) => item.id === share.id ? share : item));
        showToast("Client view updated");
      } else {
        const { share } = await api.clientShares.create(taskId, {
          actor_id: currentUserId ?? null,
          settings: clientShareSettings,
        });
        setClientShares((current) => [share, ...current]);
        showToast("Client link created");
      }
    } catch (err) {
      setClientShareError(err instanceof Error ? err.message : "Could not save client link");
    } finally {
      setClientShareLoading(false);
    }
  };

  const revokeClientShare = async () => {
    if (!activeClientShare || !canManageProject) return;
    setClientShareLoading(true);
    setClientShareError(null);
    try {
      const { share } = await api.clientShares.update(activeClientShare.id, {
        actor_id: currentUserId ?? null,
        is_active: false,
      });
      setClientShares((current) => current.map((item) => item.id === share.id ? share : item));
      showToast("Client link revoked");
    } catch (err) {
      setClientShareError(err instanceof Error ? err.message : "Could not revoke client link");
    } finally {
      setClientShareLoading(false);
    }
  };

  const copyClientShare = async () => {
    if (!clientShareUrl) return;
    await navigator.clipboard.writeText(clientShareUrl).catch(() => undefined);
    showToast("Client link copied");
  };

  const updateClientSetting = <K extends keyof ClientShareSettings>(key: K, value: ClientShareSettings[K]) => {
    setClientShareSettings((current) => ({ ...current, [key]: value }));
  };

  const generateWeeklyReport = async () => {
    if (!project || !projectRisk || weeklyReportLoading) return;
    setWeeklyReportLoading(true);
    setCompletionError(null);
    try {
      const { response } = await api.ai.chat({
        message: "Write a concise weekly project report with progress, risk summary, exact risk reasons, and practical corrective actions. Keep it under 180 words.",
        context: `Project: ${project.name}
Description: ${project.description}
Progress: ${progress}%
Health: ${100 - projectRisk.score}% (${projectRisk.level} risk)
Risk reasons: ${projectRisk.reasons.join("; ")}
Suggested actions: ${projectRisk.actions.join("; ")}
Open tasks: ${tasks.filter((task) => task.status !== "Done").length}
Blocked tasks: ${blockedTasks.map((task) => task.title).join(", ") || "None"}`,
      });
      setWeeklyReport(response);
    } catch (err) {
      setCompletionError(err instanceof Error ? err.message : "Failed to generate weekly report");
      setTimeout(() => setCompletionError(null), 4000);
    } finally {
      setWeeklyReportLoading(false);
    }
  };

  const assignedIds = new Set(members.map((m) => m.user_id));
  const availableToAdd = allUsers.filter((u) => !assignedIds.has(u.id));

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">{t("detail.loading")}</p>
        </div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
        <p className="text-red-400 mb-4">{error ?? t("detail.notFound")}</p>
        <Link to="/" className="text-purple-400 hover:text-purple-300 underline text-sm">← {t("detail.back")}</Link>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 p-4 sm:p-6 lg:p-10 xl:p-12 flex flex-col lg:flex-row gap-6 lg:gap-8 overflow-hidden">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            className="fixed right-6 top-20 z-50 rounded-xl border border-green-500/30 bg-green-950/90 px-4 py-3 text-sm font-semibold text-green-200 shadow-xl shadow-green-500/10 backdrop-blur-xl"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Left Panel — Project info + scrollable task list */}
      <div className={`min-w-0 min-h-0 flex-1 space-y-6 overflow-y-auto pr-1 lg:pr-2 ${isMobile && selectedTaskId ? "hidden" : ""}`}>
        <Link to="/">
          <motion.button whileHover={{ x: -5 }} className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors text-lg">
            <ArrowLeft className="w-5 h-5 rtl:rotate-180" /><span>{t("detail.back")}</span>
          </motion.button>
        </Link>

        <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h2 className="text-4xl xl:text-5xl mb-4 bg-linear-to-r from-white to-gray-400 bg-clip-text text-transparent wrap-break-word leading-tight">{project.name}</h2>
            <div className="flex flex-wrap items-center gap-4">
              <span className={`px-5 py-2 rounded-full text-base font-semibold ${project.status === "Completed" ? "bg-linear-to-r from-green-600 to-emerald-600 text-white shadow-xl shadow-green-500/50" : "bg-linear-to-r from-purple-600 to-purple-900 text-white shadow-xl shadow-purple-500/50"}`}>{t(`detail.projectStatus.${project.status}`, { defaultValue: project.status })}</span>
              <span className="px-5 py-2 rounded-full text-base font-semibold bg-linear-to-r from-gray-600 to-gray-700 text-white shadow-xl shadow-gray-500/30">{t("detail.complete", { progress })}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <div className="relative">
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => setShowExportMenu((value) => !value)}
                disabled={!canExportProject}
                title={!canExportProject ? t("detail.guestExport") : undefined}
                className="flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:border-purple-400/50 hover:bg-purple-900/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                {t("detail.export")}
              </motion.button>
              <AnimatePresence>
                {showExportMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    className="absolute right-0 top-12 z-30 w-44 overflow-hidden rounded-xl border border-white/10 app-surface-elevated p-1 shadow-2xl shadow-black/40 backdrop-blur-xl"
                  >
                    {[
                      { label: t("detail.exports.pdf"), value: "pdf" }, { label: t("detail.exports.word"), value: "docx" }, { label: t("detail.exports.csv"), value: "csv" }, { label: t("detail.exports.excel"), value: "xlsx" },
                    ].map((item) => (
                      <button
                        key={item.value}
                        onClick={() => handleExport(item.value as ExportFormat)}
                        className="block w-full rounded-lg px-3 py-2.5 text-left text-sm text-gray-300 transition-colors hover:bg-purple-900/35 hover:text-white"
                      >
                        {item.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-300">{roleLabel}</span>
            {canManageMembers && (
              <motion.button
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleSaveTemplate}
                disabled={savingTemplate}
                className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/40 bg-purple-900/30 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:border-purple-400/70 hover:bg-purple-800/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingTemplate ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-transparent" /> : <BookmarkPlus className="h-4 w-4" />}
                {t("detail.saveTemplate")}
              </motion.button>
            )}
          </div>
        </div>

        {/* Project info cards */}
        <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
          <motion.div whileHover={{ y: -3 }} className="min-w-0 bg-linear-to-br from-white/7 to-white/2 backdrop-blur-2xl border border-white/20 rounded-2xl p-6 hover:border-purple-500/50 transition-all">
            <div className="flex items-center gap-3 text-gray-400 mb-3"><CalendarIcon className="w-5 h-5" /><span className="text-base">{t("detail.created")}</span></div>
            <p className="text-2xl font-semibold">{formatDate(project.created_at, locale)}</p>
          </motion.div>
          <motion.div whileHover={{ y: -3 }} className="min-w-0 bg-linear-to-br from-white/7 to-white/2 backdrop-blur-2xl border border-white/20 rounded-2xl p-6 hover:border-purple-500/50 transition-all">
            <div className="flex items-center gap-3 text-gray-400 mb-3"><CalendarIcon className="w-5 h-5" /><span className="text-base">{t("detail.progress")}</span></div>
            <div className="flex items-center gap-4">
              <p className="text-2xl font-semibold">{t("detail.taskCountProgress", { done: doneTasks, total: tasks.length })}</p>
              <div className="flex-1 h-3 app-input rounded-full overflow-hidden border border-white/10">
                <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 1, ease: "easeOut" }} className="h-full rounded-full bg-linear-to-r from-purple-600 to-purple-400" />
              </div>
            </div>
          </motion.div>
        </div>

        {projectRisk && (
          <div className={`min-w-0 rounded-2xl border p-5 ${riskStyle(projectRisk.level)}`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold">{t("detail.health.title")}</h3>
                <p className="mt-1 text-sm opacity-80">{t("detail.health.summary", { health: 100 - projectRisk.score, level: t(`risk.${projectRisk.level.toLowerCase()}`) })}</p>
              </div>
              <span className="rounded-full border border-current/30 px-3 py-1 text-xs font-semibold">{t(`risk.${projectRisk.level.toLowerCase()}`)}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">{t("detail.health.reasons")}</div>
                <ul className="space-y-1 text-sm">
                  {projectRisk.reasons.slice(0, 4).map((reason) => <li key={reason}>- {translateProjectRisk(t, reason)}</li>)}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">{t("detail.health.actions")}</div>
                <ul className="space-y-1 text-sm">
                  {projectRisk.actions.slice(0, 4).map((action) => <li key={action}>- {translateProjectRisk(t, action)}</li>)}
                </ul>
              </div>
            </div>
            <button
              onClick={generateWeeklyReport}
              disabled={weeklyReportLoading}
              className="mt-4 rounded-xl border border-current/25 px-3 py-2 text-xs font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              {weeklyReportLoading ? t("detail.health.generatingReport") : t("detail.health.generateReport")}
            </button>
            {weeklyReport && (
              <div className="mt-4 rounded-xl border border-current/20 bg-black/20 p-3 text-sm leading-6">
                {weeklyReport}
              </div>
            )}
          </div>
        )}

        {canViewCapacity && <div className="min-w-0 rounded-2xl border border-white/20 bg-linear-to-br from-white/7 to-white/2 p-6 backdrop-blur-2xl">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Timer className="h-5 w-5 text-purple-300" />
              <div>
                <h3 className="text-xl font-semibold">{t("detail.accuracy.title")}</h3>
                <p className="mt-1 text-sm text-gray-500">{t("detail.accuracy.subtitle")}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => exportTimesheet("csv")} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300 hover:border-purple-500/40">CSV</button>
              <button onClick={() => exportTimesheet("xlsx")} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300 hover:border-purple-500/40">Excel</button>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-white/10 app-surface-soft p-3">
              <div className="text-xs text-gray-500">{t("detail.accuracy.actual")}</div>
              <div className="mt-1 text-xl font-semibold text-white">{formatMinutes(timeTotals?.actual_minutes ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-white/10 app-surface-soft p-3">
              <div className="text-xs text-gray-500">{t("detail.accuracy.estimate")}</div>
              <div className="mt-1 text-xl font-semibold text-white">{formatMinutes(timeTotals?.estimated_minutes ?? tasks.reduce((sum, task) => sum + Number(task.estimated_days || 0) * 8 * 60, 0))}</div>
            </div>
            <div className="rounded-xl border border-white/10 app-surface-soft p-3">
              <div className="text-xs text-gray-500">{t("detail.accuracy.accuracy")}</div>
              <div className="mt-1 text-xl font-semibold text-white">{timeTotals?.estimate_accuracy === null || timeTotals?.estimate_accuracy === undefined ? "-" : `${timeTotals.estimate_accuracy}%`}</div>
            </div>
          </div>
          {timeError && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{timeError}</p>}
          <div className="mt-4 max-h-52 overflow-y-auto rounded-xl border border-white/10">
            {timeTasks.length === 0 ? (
              <p className="p-4 text-center text-sm text-gray-600">{t("detail.accuracy.noTime")}</p>
            ) : timeTasks.slice(0, 8).map((task) => (
              <button key={task.id} onClick={() => setSelectedTaskId(task.id)} className="grid w-full grid-cols-[1fr_auto_auto] gap-3 border-b border-white/5 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-white/5">
                <span className="truncate text-gray-200">{task.title}</span>
                <span className="text-gray-500">{formatMinutes(task.actual_minutes)}</span>
                <span className="text-gray-500">{task.estimate_accuracy === null ? "-" : `${task.estimate_accuracy}%`}</span>
              </button>
            ))}
          </div>
          <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t("detail.accuracy.timesheet")}</div>
            {weeklyTimesheet.length === 0 ? (
              <p className="text-sm text-gray-600">{t("detail.accuracy.noEntries")}</p>
            ) : (
              <div className="space-y-2">
                {weeklyTimesheet.map(([week, minutes]) => (
                  <div key={week} className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{t("detail.accuracy.weekOf", { date: week })}</span>
                    <span className="font-semibold text-white">{formatMinutes(minutes)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>}

        <div className="min-w-0 bg-linear-to-br from-white/7 to-white/2 backdrop-blur-2xl border border-white/20 rounded-2xl p-5 sm:p-8">
          <h3 className="text-2xl mb-4 font-semibold">{t("detail.description")}</h3>
          <p className="text-gray-300 text-lg leading-relaxed">{project.description}</p>
        </div>

        {canManageProject && (
          <div className="min-w-0 rounded-2xl border border-white/20 bg-linear-to-br from-white/7 to-white/2 p-6 backdrop-blur-2xl">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <Share2 className="h-5 w-5 text-purple-300" />
                <div>
                  <h3 className="text-xl font-semibold">Client Portal</h3>
                  <p className="mt-1 text-sm text-gray-500">Share clean progress without internal workload, private notes, or team capacity.</p>
                </div>
              </div>
              {activeClientShare ? (
                <span className="rounded-full border border-green-500/30 bg-green-900/20 px-3 py-1 text-xs font-semibold text-green-300">Active link</span>
              ) : (
                <span className="rounded-full border border-white/10 app-surface-soft px-3 py-1 text-xs text-gray-500">Not shared</span>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["show_milestones", "Milestones"],
                ["show_tasks", "Tasks"],
                ["show_current_tasks", "Current tasks"],
                ["show_upcoming_tasks", "Upcoming tasks"],
                ["show_completed_tasks", "Completed tasks"],
                ["show_internal_risks", "Shared risk note"],
                ["allow_client_comments", "Client comments"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between rounded-xl border border-white/10 app-surface-soft px-3 py-2 text-sm text-gray-300">
                  {label}
                  <input
                    type="checkbox"
                    checked={Boolean(clientShareSettings[key as keyof ClientShareSettings])}
                    onChange={(e) => updateClientSetting(key as keyof ClientShareSettings, e.target.checked as ClientShareSettings[keyof ClientShareSettings])}
                    className="h-4 w-4 accent-purple-500"
                  />
                </label>
              ))}
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                value={clientShareSettings.brand_label}
                onChange={(e) => updateClientSetting("brand_label", e.target.value)}
                placeholder="Client-facing label, e.g. Weekly Project Status"
                className="rounded-xl border border-white/10 app-input px-3 py-3 text-sm text-white outline-none placeholder-gray-600 focus:border-purple-500/50"
              />
              <button
                onClick={createOrUpdateClientShare}
                disabled={clientShareLoading}
                className="rounded-xl border border-purple-500/40 bg-purple-900/30 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-800/40 disabled:opacity-40"
              >
                {clientShareLoading ? "Saving..." : activeClientShare ? "Update view" : "Create link"}
              </button>
            </div>

            {activeClientShare && (
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-white/10 app-surface-soft p-3 md:flex-row md:items-center">
                <div className="min-w-0 flex-1 truncate text-xs text-gray-400">{clientShareUrl}</div>
                <button onClick={copyClientShare} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-gray-200 hover:border-purple-500/40">
                  <Copy className="h-3.5 w-3.5" /> Copy
                </button>
                <button onClick={revokeClientShare} disabled={clientShareLoading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-900/20 disabled:opacity-40">
                  <EyeOff className="h-3.5 w-3.5" /> Revoke
                </button>
              </div>
            )}

            <p className="mt-3 text-xs text-gray-500">Internal comments, capacity, time tracking, private AI chat, and internal risk details stay hidden by default.</p>
            {clientShareError && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{clientShareError}</p>}
          </div>
        )}

        <div className="min-w-0 rounded-2xl border border-white/20 bg-linear-to-br from-white/7 to-white/2 p-6 backdrop-blur-2xl">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <Github className="h-5 w-5 text-purple-300" />
              <div>
                <h3 className="text-xl font-semibold">GitHub</h3>
                <p className="mt-1 text-sm text-gray-500">{t("detail.integrations.githubHelp")}</p>
              </div>
            </div>
            {githubRepo && (
              <span className="rounded-full border border-green-500/30 bg-green-900/20 px-3 py-1 text-xs font-semibold text-green-300">{t("detail.integrations.connected")}</span>
            )}
          </div>

          {githubRepo ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 app-surface-soft p-3">
                <div className="min-w-0">
                  <a href={githubRepo.repo_url} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-white hover:text-purple-200">
                    {githubRepo.owner}/{githubRepo.repo}
                  </a>
                  <div className="mt-1 text-xs text-gray-500">Default branch: {githubRepo.default_branch ?? "unknown"}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={importGithubIssues}
                    disabled={githubLoading || !canEditTasks}
                    className="inline-flex items-center gap-2 rounded-lg border border-purple-500/35 bg-purple-900/20 px-3 py-2 text-xs font-semibold text-purple-100 hover:bg-purple-900/35 disabled:opacity-40"
                  >
                    <UploadCloud className="h-3.5 w-3.5" /> Import issues
                  </button>
                  <button
                    onClick={disconnectGithubRepo}
                    disabled={githubLoading || !canManageIntegrations}
                    className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-gray-400 hover:border-red-500/40 hover:bg-red-900/20 hover:text-red-200 disabled:opacity-40"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3 md:flex-row">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  value={githubRepoInput}
                  onChange={(e) => setGithubRepoInput(e.target.value)}
                  disabled={!canManageIntegrations}
                  placeholder="owner/repo or https://github.com/owner/repo"
                  className="w-full rounded-xl border border-white/10 app-input py-3 pl-10 pr-3 text-sm text-white outline-none placeholder-gray-600 focus:border-purple-500/50 disabled:opacity-40"
                />
              </div>
              <button
                onClick={connectGithubRepo}
                disabled={githubLoading || !githubRepoInput.trim() || !canManageIntegrations}
                className="rounded-xl border border-purple-500/40 bg-purple-900/30 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-800/40 disabled:opacity-40"
              >
                {githubLoading ? t("detail.integrations.connecting") : t("detail.integrations.connectRepo")}
              </button>
            </div>
          )}
          {!canManageIntegrations && <p className="mt-3 text-xs text-gray-500">{t("detail.integrations.adminOnly")}</p>}
          {githubError && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{githubError}</p>}
        </div>

        <div className="min-w-0 rounded-2xl border border-white/20 bg-linear-to-br from-white/7 to-white/2 p-6 backdrop-blur-2xl">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <CalendarPlus className="h-5 w-5 text-purple-300" />
              <div>
                <h3 className="text-xl font-semibold">{t("detail.integrations.calendar")}</h3>
                <p className="mt-1 text-sm text-gray-500">{t("detail.integrations.calendarHelp")}</p>
              </div>
            </div>
            {calendarConnection && (
              <span className="rounded-full border border-green-500/30 bg-green-900/20 px-3 py-1 text-xs font-semibold text-green-300">{t("detail.integrations.googleConnected")}</span>
            )}
          </div>

          {calendarConnection ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 app-surface-soft p-3">
                <div className="text-sm font-semibold text-white">{calendarConnection.calendar_name ?? "Google Calendar"}</div>
                <div className="mt-1 text-xs text-gray-500">
                  Timezone: {calendarConnection.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone}
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 app-surface-soft px-3 py-2 text-sm text-gray-300">
                  Sync enabled
                  <input
                    type="checkbox"
                    checked={calendarConnection.sync_enabled}
                    onChange={(e) => updateCalendarSettings({ sync_enabled: e.target.checked })}
                    disabled={!canManageIntegrations}
                    className="h-4 w-4 accent-purple-500"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 app-surface-soft px-3 py-2 text-sm text-gray-300">
                  Work blocks by default
                  <input
                    type="checkbox"
                    checked={calendarConnection.create_work_blocks}
                    onChange={(e) => updateCalendarSettings({ create_work_blocks: e.target.checked })}
                    disabled={!canManageIntegrations}
                    className="h-4 w-4 accent-purple-500"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => updateCalendarSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
                  disabled={calendarLoading || !canManageIntegrations}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-gray-300 hover:border-purple-500/40 hover:bg-purple-900/20 disabled:opacity-40"
                >
                  Use my timezone
                </button>
                <button
                  onClick={disconnectCalendar}
                  disabled={calendarLoading || !canManageIntegrations}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-gray-400 hover:border-red-500/40 hover:bg-red-900/20 hover:text-red-200 disabled:opacity-40"
                >
                  Disconnect
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={connectGoogleCalendar}
                disabled={calendarLoading || !currentUserId || !canManageIntegrations}
                className="rounded-xl border border-purple-500/40 bg-purple-900/30 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-800/40 disabled:opacity-40"
              >
                {calendarLoading ? t("detail.integrations.connecting") : t("detail.integrations.connectCalendar")}
              </button>
              <p className="text-xs text-gray-500">{t("detail.integrations.calendarNote")}</p>
            </div>
          )}
          {!canManageIntegrations && <p className="mt-3 text-xs text-gray-500">{t("detail.integrations.calendarAdminOnly")}</p>}
          {calendarError && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{calendarError}</p>}
        </div>

        <div className="min-w-0 rounded-2xl border border-white/20 bg-linear-to-br from-white/7 to-white/2 p-6 backdrop-blur-2xl">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-purple-300" />
              <div>
                <h3 className="text-xl font-semibold">{t("detail.integrations.slack")}</h3>
                <p className="mt-1 text-sm text-gray-500">{t("detail.integrations.slackHelp")}</p>
              </div>
            </div>
            {slackIntegration && (
              <span className="rounded-full border border-green-500/30 bg-green-900/20 px-3 py-1 text-xs font-semibold text-green-300">{t("detail.integrations.connected")}</span>
            )}
          </div>

          {slackIntegration ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <input
                  value={slackChannelInput}
                  onChange={(e) => setSlackChannelInput(e.target.value)}
                  onBlur={() => updateSlackSettings({ channel_name: slackChannelInput.trim() })}
                  disabled={!canManageIntegrations}
                  placeholder="#project-channel"
                  className="rounded-xl border border-white/10 app-input px-3 py-2 text-sm text-white outline-none placeholder-gray-600 focus:border-purple-500/50 disabled:opacity-40"
                />
                <button
                  onClick={sendSlackSummary}
                  disabled={slackLoading || !canManageIntegrations}
                  className="rounded-xl border border-purple-500/35 bg-purple-900/20 px-3 py-2 text-xs font-semibold text-purple-100 hover:bg-purple-900/35 disabled:opacity-40"
                >
                  Send summary
                </button>
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ["assignment_notifications", "Assignments"],
                  ["overdue_alerts", "Overdue alerts"],
                  ["project_risk_alerts", "Risk alerts"],
                  ["mention_notifications", "Mentions"],
                  ["summary_notifications", "Summaries"],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 app-surface-soft px-3 py-2 text-sm text-gray-300">
                    {label}
                    <input
                      type="checkbox"
                      checked={Boolean(slackIntegration[key as keyof SlackIntegration])}
                      onChange={(e) => updateSlackSettings({ [key]: e.target.checked } as Partial<SlackIntegration>)}
                      disabled={!canManageIntegrations}
                      className="h-4 w-4 accent-purple-500"
                    />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={slackIntegration.summary_frequency}
                  onChange={(e) => updateSlackSettings({ summary_frequency: e.target.value as SlackIntegration["summary_frequency"] })}
                  disabled={!canManageIntegrations}
                  className="rounded-lg border border-white/10 app-input px-3 py-2 text-xs text-gray-300 outline-none focus:border-purple-500/50"
                >
                  <option value="weekly">Weekly summary</option>
                  <option value="daily">Daily summary</option>
                  <option value="off">No scheduled summary</option>
                </select>
                <button
                  onClick={disconnectSlack}
                  disabled={slackLoading || !canManageIntegrations}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-gray-400 hover:border-red-500/40 hover:bg-red-900/20 hover:text-red-200 disabled:opacity-40"
                >
                  Disconnect
                </button>
              </div>
              {slackIntegration.last_error && <p className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{slackIntegration.last_error}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <input
                value={slackWebhookInput}
                onChange={(e) => setSlackWebhookInput(e.target.value)}
                disabled={!canManageIntegrations}
                placeholder="Slack incoming webhook URL"
                className="w-full rounded-xl border border-white/10 app-input px-3 py-3 text-sm text-white outline-none placeholder-gray-600 focus:border-purple-500/50 disabled:opacity-40"
              />
              <input
                value={slackChannelInput}
                onChange={(e) => setSlackChannelInput(e.target.value)}
                disabled={!canManageIntegrations}
                placeholder="Channel name (optional)"
                className="w-full rounded-xl border border-white/10 app-input px-3 py-3 text-sm text-white outline-none placeholder-gray-600 focus:border-purple-500/50 disabled:opacity-40"
              />
              <button
                onClick={connectSlack}
                disabled={slackLoading || !slackWebhookInput.trim() || !canManageIntegrations}
                className="rounded-xl border border-purple-500/40 bg-purple-900/30 px-4 py-3 text-sm font-semibold text-white hover:bg-purple-800/40 disabled:opacity-40"
              >
                {slackLoading ? t("detail.integrations.connecting") : t("detail.integrations.connectSlack")}
              </button>
              <p className="text-xs text-gray-500">{t("detail.integrations.teamsNote")}</p>
            </div>
          )}
          {!canManageIntegrations && <p className="mt-3 text-xs text-gray-500">{t("detail.integrations.slackAdminOnly")}</p>}
          {slackError && <p className="mt-3 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{slackError}</p>}
        </div>

        {/* Team Members */}
        <div className="min-w-0 bg-linear-to-br from-white/7 to-white/2 backdrop-blur-2xl border border-white/20 rounded-2xl p-5 sm:p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3"><Users className="w-5 h-5 text-purple-400" /><h3 className="text-2xl font-semibold">{t("detail.team.title", { count: members.length })}</h3></div>
            {canManageMembers && (
              <motion.button whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }} onClick={() => setShowAddMember((v) => !v)} className="flex items-center gap-2 rounded-xl border border-purple-500/40 bg-purple-900/30 px-4 py-2 text-sm font-semibold text-white hover:border-purple-400/70 hover:bg-purple-800/40 transition-all">
                <UserPlus className="h-4 w-4" /> {t("detail.team.inviteMember")}
              </motion.button>
            )}
          </div>

          <AnimatePresence>
            {showAddMember && canManageMembers && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="mb-5 rounded-xl border border-purple-500/30 bg-black/50 p-4">
                <div className="mb-3 grid gap-2 md:grid-cols-[1fr_auto_auto]">
                  <input
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder={t("detail.team.invitePlaceholder")}
                    className="rounded-lg border border-white/10 app-input px-3 py-2 text-sm text-white outline-none placeholder-gray-600 focus:border-purple-500/50"
                  />
                  <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as ProjectRole)} className="rounded-lg border border-white/10 app-input px-3 py-2 text-sm text-gray-200 outline-none focus:border-purple-500/50">
                    <option value="Admin">{t("detail.roles.Admin")}</option><option value="Member">{t("detail.roles.Member")}</option><option value="Guest">{t("detail.roles.Guest")}</option><option value="Owner">{t("detail.roles.Owner")}</option>
                  </select>
                  <button
                    onClick={handleInviteMember}
                    disabled={memberActionId === "invite" || !inviteEmail.trim()}
                    className="rounded-lg border border-purple-500/40 bg-purple-900/30 px-3 py-2 text-sm font-semibold text-white hover:bg-purple-800/40 disabled:opacity-40"
                  >
                    {memberActionId === "invite" ? t("detail.team.inviting") : t("detail.team.invite")}
                  </button>
                </div>
                {memberError && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{memberError}</p>}
                {availableToAdd.length === 0 ? (
                  <p className="text-sm text-gray-500 text-center py-2">{t("detail.team.noUsers")}</p>
                ) : (
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {availableToAdd.map((user) => (
                      <button key={user.id} onClick={() => handleAddMember(user.id)} disabled={memberActionId === user.id} className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/3 px-3 py-2.5 text-left hover:border-purple-500/40 hover:bg-purple-900/20 transition-all disabled:opacity-50">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-purple-600 to-purple-800 text-xs font-bold text-white">{getInitials(user.full_name, user.email)}</div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">{user.full_name ?? user.email}</div>
                          <div className="truncate text-xs text-gray-500">{user.email}</div>
                        </div>
                        {memberActionId === user.id ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-400 border-t-transparent" /> : <UserPlus className="h-4 w-4 text-purple-400" />}
                      </button>
                    ))}
                  </div>
                )}
                {invitations.length > 0 && (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t("detail.team.pending")}</div>
                    <div className="space-y-1">
                      {invitations.map((invite) => (
                        <div key={invite.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-xs text-gray-400">
                          <span>{invite.email}</span>
                          <span>{invite.role}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          {!canManageMembers && <p className="mb-4 text-xs text-gray-500">{t("detail.team.adminOnly")}</p>}

          {members.length === 0 ? (
            <p className="text-sm text-gray-600 italic">{t("detail.team.empty")}</p>
          ) : (
            <div className="space-y-3">
              {members.map((member, i) => (
                <motion.div key={member.user_id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/3 p-3 group">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br ${GRADIENTS[i % GRADIENTS.length]} text-sm font-bold text-white`}>{getInitials(member.full_name, member.email)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{member.full_name ?? member.email}</div>
                    {canManageMembers ? (
                      <select
                        value={member.role}
                        onChange={(e) => handleChangeMemberRole(member.user_id, e.target.value as ProjectRole)}
                        disabled={memberActionId === member.user_id}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 rounded-md border border-white/10 app-input px-2 py-1 text-xs text-gray-300 outline-none focus:border-purple-500/50 disabled:opacity-40"
                      >
                        <option value="Owner">{t("detail.roles.Owner")}</option><option value="Admin">{t("detail.roles.Admin")}</option><option value="Member">{t("detail.roles.Member")}</option><option value="Guest">{t("detail.roles.Guest")}</option>
                      </select>
                    ) : (
                      <div className="truncate text-xs text-gray-500">{t(`detail.roles.${member.role}`)}</div>
                    )}
                  </div>
                  {canManageMembers && (
                    <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }} onClick={() => handleRemoveMember(member.user_id)} disabled={memberActionId === member.user_id} className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-gray-600 opacity-0 group-hover:opacity-100 hover:border-red-500/40 hover:bg-red-900/20 hover:text-red-400 transition-all disabled:opacity-30" aria-label={`Remove ${member.full_name ?? member.email}`}>
                      {memberActionId === member.user_id ? <div className="h-3 w-3 animate-spin rounded-full border-2 border-red-400 border-t-transparent" /> : <UserMinus className="h-3.5 w-3.5" />}
                    </motion.button>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>

        {blockedTasks.length > 0 && (
          <div className="min-w-0 rounded-2xl border border-red-500/30 bg-red-950/20 p-5">
            <div className="mb-4 flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-red-300" />
              <h3 className="text-xl font-semibold text-red-100">{t("detail.blockedWork")}</h3>
              <span className="rounded-full border border-red-500/30 bg-red-900/30 px-2 py-0.5 text-xs text-red-200">{blockedTasks.length}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {blockedTasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className="rounded-xl border border-red-500/20 app-surface-soft p-3 text-left transition-colors hover:border-red-400/50"
                >
                  <div className="truncate text-sm font-semibold text-white">{task.title}</div>
                  <div className="mt-2 text-xs text-red-200">
                    {t("detail.blockedBy", { tasks: (task.blocked_by ?? []).filter((item) => item.status !== "Done").map((item) => item.title).join(", ") })}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Tasks Section — list + Kanban */}
        <div className="min-w-0 bg-linear-to-br from-white/7 to-white/2 backdrop-blur-2xl border border-white/20 rounded-2xl p-5 sm:p-8">
          <div className="flex flex-col gap-4 mb-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-purple-400" />
              <h3 className="text-2xl font-semibold">{t("detail.tasks", { count: tasks.length })}</h3>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-xl border border-white/10 app-surface-soft p-1">
                <button
                  onClick={() => setView("list")}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${view === "list" ? "bg-purple-600 text-white shadow-sm shadow-purple-500/20" : "text-gray-500 hover:text-gray-300"}`}
                >
                  <List className="h-3.5 w-3.5" /> {t("detail.list")}
                </button>
                <button
                  onClick={() => setView("kanban")}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${view === "kanban" ? "bg-purple-600 text-white shadow-sm shadow-purple-500/20" : "text-gray-500 hover:text-gray-300"}`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" /> {t("detail.kanban")}
                </button>
              </div>
              {canEditTasks ? (
                <AddTaskForm projectId={taskId!} members={members} currentUserId={currentUserId} onCreated={handleTaskCreated} />
              ) : (
                <span className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs text-gray-500">{t("detail.viewOnly")}</span>
              )}
            </div>
          </div>

          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 app-surface-soft p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
              <Filter className="h-3.5 w-3.5" /> {t("detail.filters")}
            </div>
            <select
              value={filters.assignee}
              onChange={(e) => setFilters((current) => ({ ...current, assignee: e.target.value }))}
              className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-gray-300 outline-none focus:border-purple-500/50"
            >
              <option value="all">{t("detail.allAssignees")}</option>
              <option value="unassigned">{t("detail.unassigned")}</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>{member.full_name ?? member.email}</option>
              ))}
            </select>
            <select
              value={filters.priority}
              onChange={(e) => setFilters((current) => ({ ...current, priority: e.target.value }))}
              className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-gray-300 outline-none focus:border-purple-500/50"
            >
              <option value="all">{t("detail.allPriorities")}</option>
              <option value="High">{t("priority.high")}</option><option value="Medium">{t("priority.medium")}</option><option value="Low">{t("priority.low")}</option>
            </select>
            <select
              value={filters.status}
              onChange={(e) => setFilters((current) => ({ ...current, status: e.target.value }))}
              className="rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-xs text-gray-300 outline-none focus:border-purple-500/50"
            >
              <option value="all">{t("detail.allStatuses")}</option>
              {KANBAN_COLUMNS.map((column) => (
                <option key={column.status} value={column.status}>{t(`status.${column.status === "Backlog" ? "backlog" : column.status === "To Do" ? "todo" : column.status === "In Progress" ? "inProgress" : column.status === "In Review" ? "inReview" : "done"}`)}</option>
              ))}
            </select>
            <label className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${filters.overdueOnly ? "border-red-500/40 bg-red-900/20 text-red-300" : "border-white/10 app-surface-soft text-gray-400 hover:text-gray-300"}`}>
              <input
                type="checkbox"
                checked={filters.overdueOnly}
                onChange={(e) => setFilters((current) => ({ ...current, overdueOnly: e.target.checked }))}
                className="h-3.5 w-3.5 accent-purple-500"
              />
              {t("detail.overdue")}
            </label>
          </div>

          {completionError && (
            <p className="text-sm text-red-400 mb-2">{completionError}</p>
          )}

          {tasks.length === 0 ? (
            <p className="text-sm text-gray-600 italic">{t("detail.noTasks")}</p>
          ) : filteredTasks.length === 0 ? (
            <p className="rounded-xl border border-white/10 bg-white/3 px-4 py-6 text-center text-sm text-gray-500">{t("detail.noMatches")}</p>
          ) : view === "kanban" ? (
            <div className="overflow-x-auto pb-2 snap-x snap-mandatory xl:snap-none">
              <div className="grid grid-flow-col auto-cols-[85%] gap-4 sm:auto-cols-[45%] xl:min-w-[1120px] xl:grid-flow-row xl:auto-cols-auto xl:grid-cols-5">
                {KANBAN_COLUMNS.map((column) => {
                  const columnTasks = filteredTasks.filter((task) => task.status === column.status);
                  const isTarget = dragOverStatus === column.status;

                  return (
                    <div
                      key={column.status}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragOverStatus(column.status);
                      }}
                      onDragLeave={() => setDragOverStatus(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (!canEditTasks) return;
                        const tid = e.dataTransfer.getData("text/task-id") || draggingTaskId;
                        if (tid) handleStatusChange(tid, column.status);
                      }}
                      className={`min-h-[420px] snap-start rounded-2xl border p-3 transition-all ${isTarget ? "border-purple-400/70 bg-purple-900/20 shadow-lg shadow-purple-500/15" : "border-white/10 app-surface-soft"}`}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${column.dot}`} />
                          <h4 className="text-sm font-semibold text-gray-200">{t(`status.${column.status === "Backlog" ? "backlog" : column.status === "To Do" ? "todo" : column.status === "In Progress" ? "inProgress" : column.status === "In Review" ? "inReview" : "done"}`)}</h4>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-gray-500">{columnTasks.length}</span>
                      </div>

                      {columnTasks.length === 0 ? (
                        <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/3 text-xs text-gray-600">
                          Drop tasks here
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {columnTasks.map((task) => {
                            const assignee = members.find((m) => m.user_id === task.assigned_to);
                            const sched = scheduleMap.get(task.id);
                            const prio = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.Medium;
                            const overdue = isOverdue(task);
                            const isDragging = draggingTaskId === task.id;
                            const scheduleWarning = sched?.hasDependencyWarning;
                            const latest = task.latest_activity_at ? new Date(task.latest_activity_at).toLocaleDateString(locale, { month: "short", day: "numeric" }) : null;

                            return (
                              <motion.div
                                key={task.id}
                                draggable={canEditTasks}
                                onDragStart={(e) => {
                                  const dragEvent = e as unknown as React.DragEvent<HTMLDivElement>;
                                  setDraggingTaskId(task.id);
                                  dragEvent.dataTransfer.setData("text/task-id", task.id);
                                  dragEvent.dataTransfer.effectAllowed = "move";
                                }}
                                onDragEnd={() => {
                                  setDraggingTaskId(null);
                                  setDragOverStatus(null);
                                }}
                                whileHover={{ y: -2 }}
                                onClick={() => setSelectedTaskId(task.id)}
                                className={`cursor-grab rounded-xl border app-panel p-3 shadow-sm transition-all active:cursor-grabbing ${isDragging ? "scale-[0.98] border-purple-400/60 opacity-60" : selectedTaskId === task.id ? "border-purple-500/60 shadow-purple-500/10" : "border-white/10 hover:border-white/25"}`}
                              >
                                <div className="mb-3 flex items-start justify-between gap-2">
                                  <h5 className={`text-sm font-medium leading-snug ${task.status === "Done" ? "text-gray-500 line-through" : "text-white"}`}>{task.title}</h5>
                                  <span className={`shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold ${prio}`}>{t(`priority.${task.priority.toLowerCase()}`)}</span>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                                  {task.is_blocked && <span className="rounded-md border border-red-500/30 bg-red-900/30 px-2 py-1 text-red-200">{t("blocked")}</span>}
                                  {scheduleWarning && <span className="rounded-md border border-yellow-500/30 bg-yellow-900/30 px-2 py-1 text-yellow-200">{t("detail.scheduleWarning")}</span>}
                                  <span className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1"><Clock className="h-3 w-3" />{t("detail.days", { count: task.estimated_days })}</span>
                                  {sched && (
                                    <span className={`rounded-md px-2 py-1 ${overdue ? "bg-red-900/30 text-red-300" : "bg-white/5 text-gray-500"}`}>
                                      {t("detail.due", { date: sched.end.toLocaleDateString(locale, { month: "short", day: "numeric" }) })}
                                    </span>
                                  )}
                                  <span className="rounded-md bg-purple-900/20 px-2 py-1 text-purple-300">{project.name}</span>
                                  {latest && <span className="rounded-md bg-white/5 px-2 py-1 text-gray-500">{t("detail.activity", { date: latest })}</span>}
                                </div>
                                <div className="mt-3 flex items-center justify-between gap-3">
                                  <div className="min-w-0 text-xs text-gray-400">
                                    {assignee ? (
                                      <span className="flex items-center gap-2 truncate">
                                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-600 to-purple-800 text-[10px] font-bold text-white">{getInitials(assignee.full_name, assignee.email)}</span>
                                        <span className="truncate">{assignee.full_name ?? assignee.email}</span>
                                      </span>
                                    ) : (
                                      <span className="text-gray-600">{t("detail.unassigned")}</span>
                                    )}
                                  </div>
                                  {task.status === "Done" && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-400" />}
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
              {filteredTasks.map((task) => {
                const assignee = members.find((m) => m.user_id === task.assigned_to);
                const isDone = task.status === "Done";
                const isSelected = selectedTaskId === task.id;
                const sched = scheduleMap.get(task.id);
                const prio = PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.Medium;
                const isDropdownOpen = assignDropdownId === task.id;
                const scheduleWarning = sched?.hasDependencyWarning;
                const latest = task.latest_activity_at ? new Date(task.latest_activity_at).toLocaleDateString(locale, { month: "short", day: "numeric" }) : null;

                return (
                  <div key={task.id} className="relative">
                    <motion.div
                      whileHover={{ y: -2 }}
                      onClick={() => setSelectedTaskId(isSelected ? null : task.id)}
                      className={`cursor-pointer p-4 rounded-xl border transition-all duration-200 ${isSelected ? "border-purple-500/60 bg-purple-900/20 shadow-lg shadow-purple-500/10" : isDone ? "border-green-500/20 bg-green-900/10 hover:border-green-500/40" : "border-white/10 bg-white/5 hover:border-white/20"}`}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const canComplete = task.assigned_to !== null && task.assigned_to === currentUserId;
                            if (canComplete) handleCompleteTask(task.id, !isDone);
                          }}
                          title={task.assigned_to !== currentUserId ? "Only the assigned user can complete this task" : undefined}
                          className="mt-0.5 shrink-0"
                        >
                          {isDone
                            ? <CheckCircle2 className="w-5 h-5 text-green-400" />
                            : <Circle className={`w-5 h-5 transition-colors ${task.assigned_to === currentUserId ? "text-gray-500 hover:text-purple-400" : "text-gray-700 cursor-not-allowed"}`} />
                          }
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-medium mb-1 ${isDone ? "line-through text-gray-500" : "text-white"}`}>{task.title}</div>
                          <div className="flex flex-wrap items-center gap-2">
                            {task.is_blocked && <span className="px-2 py-0.5 rounded text-[10px] font-semibold border border-red-500/40 bg-red-900/30 text-red-300">{t("blocked")}</span>}
                            {scheduleWarning && <span className="px-2 py-0.5 rounded text-[10px] font-semibold border border-yellow-500/40 bg-yellow-900/30 text-yellow-300">{t("detail.scheduleWarning")}</span>}
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${prio}`}>{t(`priority.${task.priority.toLowerCase()}`)}</span>
                            <span className="flex items-center gap-1 text-[10px] text-gray-400"><Clock className="w-3 h-3" />{t("detail.days", { count: task.estimated_days })}</span>
                            {(task.assigned_tech ?? []).slice(0, 2).map((t) => (
                              <span key={t} className="px-2 py-0.5 rounded text-[10px] bg-purple-900/30 border border-purple-500/20 text-purple-300">{t}</span>
                            ))}
                            {(task.assigned_tech ?? []).length > 2 && <span className="text-[10px] text-gray-500">+{task.assigned_tech.length - 2}</span>}
                            {sched && <span className="text-[10px] text-gray-500">{sched.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} → {sched.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>}
                            {latest && <span className="text-[10px] text-gray-500">{t("detail.activity", { date: latest })}</span>}
                          </div>
                          {isDone && task.completer_name && <div className="text-[10px] text-green-400/70 mt-1">✓ by {task.completer_name}</div>}
                        </div>

                        {/* Assign button */}
                        <button onClick={(e) => { e.stopPropagation(); if (canEditTasks) setAssignDropdownId(isDropdownOpen ? null : task.id); }} disabled={assigningTaskId === task.id || !canEditTasks} aria-label={assignee ? (assignee.full_name ?? assignee.email) : t("detail.assign")} className="flex items-center gap-1.5 shrink-0 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-400 hover:border-purple-500/40 hover:bg-purple-900/20 hover:text-purple-300 transition-all disabled:opacity-40">
                          {assigningTaskId === task.id ? (
                            <div className="h-3 w-3 animate-spin rounded-full border border-purple-400 border-t-transparent" />
                          ) : assignee ? (
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-linear-to-br from-purple-600 to-purple-800 text-[10px] font-bold text-white">{getInitials(assignee.full_name, assignee.email)}</div>
                          ) : (
                            <UserPlus className="h-3 w-3" />
                          )}
                          {/* Name hidden on phones so the task title keeps the width */}
                          <span className="hidden sm:inline">{assignee ? (assignee.full_name ?? assignee.email).split(" ")[0] : t("detail.assign")}</span>
                          <ChevronDown className={`h-3 w-3 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`} />
                        </button>
                      </div>
                    </motion.div>

                    <AnimatePresence>
                      {isDropdownOpen && (
                        <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.12 }} className="absolute right-0 top-full mt-1 z-20 w-52 rounded-xl border border-white/10 app-surface-elevated backdrop-blur-xl shadow-2xl overflow-hidden">
                          {members.length === 0 ? (
                            <p className="px-4 py-3 text-xs text-gray-500">{t("detail.team.empty")}</p>
                          ) : (
                            <div className="p-1.5 space-y-0.5">
                              {assignee && (
                                <button onClick={() => handleAssignTask(task.id, null)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors">
                                  <UserMinus className="h-3.5 w-3.5 shrink-0" /> Unassign
                                </button>
                              )}
                              {members.map((m) => (
                                <button key={m.user_id} onClick={() => handleAssignTask(task.id, m.user_id)} className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-colors ${m.user_id === task.assigned_to ? "bg-purple-900/30 text-purple-300" : "text-gray-300 hover:bg-white/5"}`}>
                                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-purple-600 to-purple-800 text-[10px] font-bold text-white">{getInitials(m.full_name, m.email)}</div>
                                  <span className="truncate">{m.full_name ?? m.email}</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel — Task Detail or AI Assistant */}
      <div
        className={`shrink-0 min-h-0 app-surface-elevated backdrop-blur-2xl border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-xl shadow-black/10 relative
          ${isMobile && !selectedTaskId ? "hidden" : ""}
          ${isMobile ? "w-full flex-1" : "w-full h-[60vh] lg:h-auto lg:w-(--task-panel-width)"}`}
        style={{ "--task-panel-width": `${taskPanelWidth}px` } as CSSProperties}
      >
        <div
          onMouseDown={(e) => startPanelResize(e.clientX)}
          onTouchStart={(e) => startPanelResize(e.touches[0].clientX)}
          onDoubleClick={() => setTaskPanelWidth(440)}
          title="Drag to resize panel"
          className="absolute left-0 top-0 z-30 hidden h-full w-4 cursor-ew-resize items-center justify-center lg:flex group"
        >
          <div className="h-20 w-1 rounded-full bg-purple-500/25 transition-colors group-hover:bg-purple-400/80" />
        </div>
        <div className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-purple-600 via-purple-500 to-transparent pointer-events-none" />

        {selectedTask ? (
          <TaskDetailPanel
            key={selectedTask.id}
            task={selectedTask}
            schedule={scheduleMap.get(selectedTask.id) ?? null}
            members={members}
            projectName={project.name}
            projectDesc={project.description}
            githubRepository={githubRepo}
            calendarConnection={calendarConnection}
            calendarEvents={calendarEvents.filter((event) => event.task_id === selectedTask.id)}
            currentUserId={currentUserId}
            canEditTasks={canEditTasks}
            canUploadFiles={Boolean(permissions?.can_upload_files)}
            onComplete={handleCompleteTask}
            onStatusChange={handleStatusChange}
            onTaskUpdated={handleTaskUpdated}
            onCalendarEventsChange={(events) => setCalendarEvents((current) => [
              ...current.filter((event) => event.task_id !== selectedTask.id),
              ...events,
            ])}
            onTimeChanged={refreshProjectTime}
            allTasks={tasks}
            onAddDependency={handleAddDependency}
            onRemoveDependency={handleRemoveDependency}
            onBack={() => setSelectedTaskId(null)}
          />
        ) : (
          /* Default AI Assistant view */
          <div className="flex flex-col h-full relative z-10">
            <div className="p-5 border-b border-white/10 app-surface">
              <div className="flex items-center gap-3 mb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 shadow-lg shadow-purple-500/20">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-2xl font-semibold text-white">{t("detail.assistant.title")}</h3>
              </div>
              <p className="text-sm text-gray-400">{t("detail.assistant.subtitle")}</p>
            </div>

            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center space-y-4">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-purple-900/12 border border-purple-500/20 flex items-center justify-center">
                  <Tag className="w-8 h-8 text-purple-400" />
                </div>
                <div>
                  <p className="text-gray-300 font-medium mb-1">{t("detail.assistant.empty")}</p>
                  <p className="text-sm text-gray-500">{t("detail.assistant.emptyHelp")}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
