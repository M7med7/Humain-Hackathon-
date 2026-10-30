import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Calendar as CalendarIcon, CheckCircle2, Circle, Pencil, Send, Sparkles, Tag, User as UserIcon, Clock, Check, X, AlertTriangle, Link2, Plus, Paperclip, Image as ImageIcon, MessageSquare, History, Upload, Trash2, ListChecks, Search, FileText, SplitSquareHorizontal, Github, GitBranch, GitPullRequest, ExternalLink, RefreshCw, CalendarPlus, Timer, Target } from "lucide-react";
import { api, type Task, type ProjectMember, type TaskComment, type TaskAttachment, type TaskActivity, type TaskChecklistItem, type GitHubRepository, type GitHubTaskLink, type GitHubCommit, type GitHubPullRequest, type CalendarConnection, type TaskCalendarEvent, type TimeEntry } from "../lib/api";
import { riskStyle, scoreTaskRisk } from "../lib/riskScoring";

interface ChatMessage { role: "user" | "ai"; content: string; }

interface ScheduleInfo { start: Date; end: Date; hasDependencyWarning?: boolean; warning?: string; }

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  High: { bg: "bg-red-900/40 border-red-500/40", text: "text-red-300", label: "🔴 High" },
  Medium: { bg: "bg-yellow-900/40 border-yellow-500/40", text: "text-yellow-300", label: "🟡 Medium" },
  Low: { bg: "bg-green-900/40 border-green-500/40", text: "text-green-300", label: "🟢 Low" },
};

// Same order and translation keys as the Kanban columns.
const TASK_STATUSES = [
  { value: "Backlog", key: "backlog" },
  { value: "To Do", key: "todo" },
  { value: "In Progress", key: "inProgress" },
  { value: "In Review", key: "inReview" },
  { value: "Done", key: "done" },
] as const;

// Phones get a shorter chat so the task details stay readable; the handle still resizes it.
const CHAT_HEIGHT_DEFAULT = 220;
const CHAT_HEIGHT_COMPACT = 140;
const COMPACT_SCREEN_MAX_WIDTH = 640;

interface StatusSelectProps {
  status: string;
  disabled: boolean;
  onChange: (status: string) => void;
}

// Lets touch users move a task between columns, since Kanban drag-and-drop needs a mouse.
function StatusSelect({ status, disabled, onChange }: StatusSelectProps) {
  const { t } = useTranslation("tasks");
  return (
    <select
      value={status}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      aria-label={t("detail.statusLabel")}
      className="rounded-lg border app-border app-input px-2 py-1.5 text-xs app-muted outline-none focus:border-purple-500/60 disabled:opacity-40"
    >
      {TASK_STATUSES.map((item) => (
        <option key={item.value} value={item.value}>{t(`status.${item.key}`)}</option>
      ))}
    </select>
  );
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function parseSteps(desc: string | null): { summary: string; steps: string[] } {
  if (!desc) return { summary: "", steps: [] };
  const parts = desc.split(/\nSteps:\n|\nsteps:\n/i);
  const summary = (parts[0] ?? "").trim();
  const steps = parts[1]
    ? parts[1].split("\n").map(s => s.replace(/^\d+\.\s*/, "").trim()).filter(Boolean)
    : [];
  return { summary, steps };
}

function newChecklistItem(text = ""): TaskChecklistItem {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, text, checked: false };
}

function incompleteQualityItems(task: Task): TaskChecklistItem[] {
  return [
    ...(task.acceptance_criteria ?? []),
    ...(task.definition_of_done ?? []),
  ].filter((item) => !item.checked);
}

function parseQualityJson(text: string): { acceptance_criteria: string[]; definition_of_done: string[] } | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      acceptance_criteria: Array.isArray(parsed.acceptance_criteria) ? parsed.acceptance_criteria.filter((item: unknown) => typeof item === "string") : [],
      definition_of_done: Array.isArray(parsed.definition_of_done) ? parsed.definition_of_done.filter((item: unknown) => typeof item === "string") : [],
    };
  } catch {
    return null;
  }
}

interface Props {
  task: Task;
  schedule: ScheduleInfo | null;
  members: ProjectMember[];
  projectName?: string;
  projectDesc?: string;
  githubRepository?: GitHubRepository | null;
  calendarConnection?: CalendarConnection | null;
  calendarEvents?: TaskCalendarEvent[];
  currentUserId?: string;
  canEditTasks?: boolean;
  canUploadFiles?: boolean;
  allTasks?: Task[];
  onComplete: (taskId: string, completed: boolean) => void;
  onStatusChange?: (taskId: string, status: string) => void;
  onTaskUpdated?: (updated: Task) => void;
  onCalendarEventsChange?: (events: TaskCalendarEvent[]) => void;
  onTimeChanged?: () => void;
  onAddDependency?: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  onRemoveDependency?: (taskId: string, dependsOnTaskId: string) => Promise<void>;
  onBack: () => void;
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function displayUser(user?: { full_name: string | null; email: string } | null): string {
  return user?.full_name ?? user?.email ?? "Someone";
}

function formatCompactDate(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fileSizeLabel(size: number | null): string {
  if (!size) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function wouldCreateCycle(taskId: string, blockerId: string, tasks: Task[]): boolean {
  const graph = new Map<string, string[]>();
  for (const item of tasks) {
    for (const dep of item.blocked_by ?? []) {
      if (!graph.has(dep.id)) graph.set(dep.id, []);
      graph.get(dep.id)!.push(item.id);
    }
  }
  if (!graph.has(blockerId)) graph.set(blockerId, []);
  graph.get(blockerId)!.push(taskId);

  const seen = new Set<string>();
  const stack = [taskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockerId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
  return false;
}

function summarizeChecklist(items: TaskChecklistItem[] | undefined): string {
  if (!items || items.length === 0) return "None yet";
  return items.slice(0, 6).map((item) => `${item.checked ? "[x]" : "[ ]"} ${item.text}`).join("; ");
}

function taskLine(item: Pick<Task, "title" | "status" | "priority" | "assigned_to">, members: ProjectMember[]): string {
  const owner = members.find((member) => member.user_id === item.assigned_to);
  return `${item.title} (${item.status}, ${item.priority}, owner: ${owner?.full_name ?? owner?.email ?? "Unassigned"})`;
}

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function TaskDetailPanel({
  task,
  schedule,
  members,
  projectName,
  projectDesc,
  githubRepository,
  calendarConnection,
  calendarEvents = [],
  currentUserId,
  canEditTasks = true,
  canUploadFiles = true,
  allTasks = [],
  onComplete,
  onStatusChange,
  onTaskUpdated,
  onCalendarEventsChange,
  onTimeChanged,
  onAddDependency,
  onRemoveDependency,
  onBack
}: Props) {
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([
    { role: "ai", content: `How can I help you with "${task.title}"?` },
  ]);
  const [sending, setSending] = useState(false);
  const [chatHeight, setChatHeight] = useState(() =>
    window.innerWidth < COMPACT_SCREEN_MAX_WIDTH ? CHAT_HEIGHT_COMPACT : CHAT_HEIGHT_DEFAULT
  );
  const [editingSchedule, setEditingSchedule] = useState(false);
  const [schedStart, setSchedStart] = useState("");
  const [schedEnd, setSchedEnd] = useState("");
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [selectedBlockerId, setSelectedBlockerId] = useState("");
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [savingDependency, setSavingDependency] = useState<string | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [collabLoading, setCollabLoading] = useState(true);
  const [commentText, setCommentText] = useState("");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [savingComment, setSavingComment] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [collabError, setCollabError] = useState<string | null>(null);
  const [savingPriority, setSavingPriority] = useState(false);
  const [savingQuality, setSavingQuality] = useState(false);
  const [improvingQuality, setImprovingQuality] = useState(false);
  const [githubLinks, setGithubLinks] = useState<GitHubTaskLink[]>([]);
  const [githubCommits, setGithubCommits] = useState<GitHubCommit[]>([]);
  const [githubPrs, setGithubPrs] = useState<GitHubPullRequest[]>([]);
  const [githubIssueInput, setGithubIssueInput] = useState("");
  const [githubBranchInput, setGithubBranchInput] = useState("");
  const [githubPrInput, setGithubPrInput] = useState("");
  const [githubLoading, setGithubLoading] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [totalMinutes, setTotalMinutes] = useState(0);
  const [timeAccuracy, setTimeAccuracy] = useState<number | null>(null);
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [timeLoading, setTimeLoading] = useState(false);
  const [timeError, setTimeError] = useState<string | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);

  const openScheduleEdit = () => {
    if (!canEditTasks) return;
    setSchedStart(task.start_date ?? (schedule ? toDateInput(schedule.start) : ""));
    setSchedEnd(task.end_date ?? (schedule ? toDateInput(schedule.end) : ""));
    setEditingSchedule(true);
  };

  const saveSchedule = async () => {
    if (!schedStart || !schedEnd) return;
    setSavingSchedule(true);
    try {
      const start = new Date(schedStart);
      const end = new Date(schedEnd);
      const estimatedDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
      await api.tasks.updateSchedule(task.id, { start_date: schedStart, end_date: schedEnd, estimated_days: estimatedDays, user_id: currentUserId ?? null });
      onTaskUpdated?.({ ...task, start_date: schedStart, end_date: schedEnd, estimated_days: estimatedDays, latest_activity_at: new Date().toISOString() });
      setEditingSchedule(false);
    } catch {
      // leave edit open on error
    } finally {
      setSavingSchedule(false);
    }
  };

  const startDrag = (clientY: number) => {
    dragRef.current = { startY: clientY, startHeight: chatHeight };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!dragRef.current) return;
      const y = ev instanceof MouseEvent ? ev.clientY : ev.touches[0].clientY;
      const delta = dragRef.current.startY - y; // drag up → bigger chat
      setChatHeight(Math.max(120, Math.min(440, dragRef.current.startHeight + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
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
  const isDone = task.status === "Done";
  const priority = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.Medium;
  const { summary, steps } = parseSteps(task.description);
  const assignee = members.find(m => m.user_id === task.assigned_to);
  const acceptanceCriteria = task.acceptance_criteria ?? [];
  const definitionOfDone = task.definition_of_done ?? [];
  const incompleteQualityCount = incompleteQualityItems(task).length;
  const taskRisk = scoreTaskRisk(task, { schedule, members, allTasks });
  const unfinishedBlockers = (task.blocked_by ?? []).filter((item) => item.status !== "Done");
  const relatedTasks = allTasks
    .filter((item) => item.id !== task.id && item.project_id === task.project_id)
    .filter((item) => (
      (task.blocked_by ?? []).some((dep) => dep.id === item.id) ||
      (task.unlocks ?? []).some((dep) => dep.id === item.id) ||
      item.assigned_to === task.assigned_to ||
      (item.assigned_tech ?? []).some((tech) => (task.assigned_tech ?? []).includes(tech))
    ))
    .slice(0, 6);
  const availableBlockers = allTasks.filter((item) => (
    item.id !== task.id &&
    item.project_id === task.project_id &&
    !(task.blocked_by ?? []).some((dep) => dep.id === item.id) &&
    !wouldCreateCycle(task.id, item.id, allTasks)
  ));

  const suggestedNextAction = (() => {
    if (task.is_blocked && unfinishedBlockers.length > 0)
      return { text: `Resolve blocker: "${unfinishedBlockers[0].title}" before continuing`, type: 'blocked' as const };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dueDate = task.end_date ? new Date(task.end_date) : (schedule?.end ?? null);
    if (task.status !== 'Done' && dueDate && dueDate < today)
      return { text: 'Overdue — update the schedule or reduce scope', type: 'overdue' as const };
    if (!task.assigned_to)
      return { text: 'No owner assigned — assign a team member to start', type: 'unassigned' as const };
    if (incompleteQualityCount > 0 && (task.status === 'In Review' || task.status === 'Done'))
      return { text: `${incompleteQualityCount} acceptance check${incompleteQualityCount === 1 ? '' : 's'} still open`, type: 'criteria' as const };
    if (taskRisk.level === 'Critical' || taskRisk.level === 'High')
      return { text: taskRisk.actions[0] ?? 'High risk — review and act', type: 'risk' as const };
    if (task.status === 'To Do')
      return { text: 'Ready to start — pick up this task', type: 'ready' as const };
    if (task.status === 'In Progress')
      return { text: 'Work in progress — check acceptance criteria as you go', type: 'progress' as const };
    return null;
  })();

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [chat]);
  useEffect(() => {
    api.tasks.collaboration(task.id)
      .then((data) => {
        setComments(data.comments);
        setAttachments(data.attachments);
        setActivity(data.activity);
      })
      .catch((err) => setCollabError(err instanceof Error ? err.message : "Failed to load collaboration"))
      .finally(() => setCollabLoading(false));
  }, [task.id]);

  useEffect(() => {
    api.time.task(task.id, currentUserId ?? null)
      .then((data) => {
        setTimeEntries(data.entries);
        setActiveTimer(data.active_timer);
        setTotalMinutes(data.total_minutes);
        setTimeAccuracy(data.estimate_accuracy);
      })
      .catch((err) => setTimeError(err instanceof Error ? err.message : "Could not load time tracking"));
  }, [task.id, currentUserId]);

  useEffect(() => {
    if (!githubRepository) return;
    api.github.getTaskLinks(task.id)
      .then((data) => setGithubLinks(data.links))
      .catch((err) => setGithubError(err instanceof Error ? err.message : "Could not load GitHub links"));
  }, [task.id, githubRepository]);

  const buildTaskAiContext = () => {
    const dueDate = task.end_date ?? (schedule ? formatDate(schedule.end) : "Not scheduled");
    const startDate = task.start_date ?? (schedule ? formatDate(schedule.start) : "Not scheduled");
    const recentComments = comments.slice(-5).map((comment) => `${displayUser(comment.users)}: ${comment.content}`).join("\n") || "No human comments yet";
    const recentActivity = activity.slice(0, 6).map((item) => `${formatCompactDate(item.created_at)} - ${item.summary}`).join("\n") || "No activity yet";
    const fileList = attachments.slice(0, 6).map((file) => `${file.file_name}${file.is_image ? " (image)" : ""}`).join(", ") || "No attached files";
    const githubLinkList = githubLinks.map((link) => [
      link.issue_number ? `issue #${link.issue_number}` : "",
      link.branch_name ? `branch ${link.branch_name}` : "",
      link.pull_request_number ? `PR #${link.pull_request_number}` : "",
    ].filter(Boolean).join(", ")).filter(Boolean).join("; ") || "No GitHub links";
    const githubActivity = [
      ...githubPrs.slice(0, 4).map((pr) => `PR #${pr.number} ${pr.merged ? "merged" : pr.state}: ${pr.title}`),
      ...githubCommits.slice(0, 4).map((commit) => `Commit ${commit.sha.slice(0, 7)}: ${commit.message?.split("\n")[0]}`),
    ].join("\n") || "No synced GitHub activity";
    const blockedBy = (task.blocked_by ?? []).map((item) => `${item.title} (${item.status})`).join(", ") || "None";
    const unlocks = (task.unlocks ?? []).map((item) => `${item.title} (${item.status})`).join(", ") || "None";
    const related = relatedTasks.map((item) => taskLine(item, members)).join("\n") || "No closely related tasks found";
    return [
      `Project name: ${projectName ?? task.project_name ?? "Untitled project"}`,
      `Project description and goals: ${projectDesc ?? "Not provided"}`,
      `Task title: ${task.title}`,
      `Task status: ${task.status}`,
      `Task priority: ${task.priority}`,
      `Task description: ${summary || task.description || "Not provided"}`,
      `Implementation steps: ${steps.length > 0 ? steps.map((step, index) => `${index + 1}. ${step}`).join(" ") : "None listed"}`,
      `Suggested technologies: ${(task.assigned_tech ?? []).join(", ") || "None listed"}`,
      `Assignee: ${assignee?.full_name ?? assignee?.email ?? "Unassigned"}`,
      `Assignee skills: ${(assignee?.skills ?? []).join(", ") || "No skills listed"}`,
      `Assignee experience: ${assignee?.experience_summary ?? "No experience summary listed"}`,
      `Blocked by: ${blockedBy}`,
      `Unlocks: ${unlocks}`,
      `Current blockers: ${unfinishedBlockers.length > 0 ? unfinishedBlockers.map((item) => item.title).join(", ") : "None"}`,
      `Start date: ${startDate}`,
      `Due date: ${dueDate}`,
      `Estimate: ${task.estimated_days ?? 1} day(s)`,
      `Acceptance criteria: ${summarizeChecklist(task.acceptance_criteria)}`,
      `Definition of done: ${summarizeChecklist(task.definition_of_done)}`,
      `Task risk: ${taskRisk.level}. Reasons: ${taskRisk.reasons.join("; ")}. Suggested actions: ${taskRisk.actions.join("; ")}`,
      `Related tasks: ${related}`,
      `Recent human comments, if allowed: ${recentComments}`,
      `Recent activity history, if allowed: ${recentActivity}`,
      `Attached files: ${fileList}`,
      `GitHub repository: ${githubRepository ? `${githubRepository.owner}/${githubRepository.repo}` : "Not connected"}`,
      `GitHub links: ${githubLinkList}`,
      `Synced GitHub activity: ${githubActivity}`,
      `Calendar sync: ${calendarConnection ? `Connected to ${calendarConnection.calendar_name ?? "Google Calendar"} (${calendarConnection.timezone ?? "UTC"})` : "Not connected"}`,
      `Time tracking: ${formatMinutes(totalMinutes)} actual vs ${task.estimated_days} estimated day(s). Estimate accuracy: ${timeAccuracy ?? "not enough data"}%.`,
    ].join("\n");
  };

  const sendPrompt = async (prompt: string, displayText = prompt) => {
    const msg = prompt.trim();
    if (!msg || sending) return;
    setMessage("");
    setChat(p => [...p, { role: "user", content: displayText }]);
    setSending(true);
    try {
      const ctx = buildTaskAiContext();
      const { response } = await api.ai.chat({ message: msg, context: ctx });
      setChat(p => [...p, { role: "ai", content: response }]);
    } catch {
      setChat(p => [...p, { role: "ai", content: "I'm having trouble connecting. Please try again." }]);
    } finally { setSending(false); }
  };

  const sendMsg = async () => {
    if (!message.trim() || sending) return;
    await sendPrompt(message.trim());
  };

  const quickActions = [
    {
      label: "Explain",
      icon: Sparkles,
      prompt: "Explain how to complete this task. Include why it matters, the safest execution path, and the next best action. Keep it concise and specific to the task context.",
    },
    {
      label: "Break Down",
      icon: SplitSquareHorizontal,
      prompt: "Break this task into 3 to 6 concrete subtasks. Include owner hints if useful, expected output for each subtask, and any dependency order.",
    },
    {
      label: "Find Risks",
      icon: Search,
      prompt: "Find the task risks and blockers from the provided context. Give exact reasons and practical actions to reduce risk.",
    },
    {
      label: "Write Update",
      icon: FileText,
      prompt: "Write a short progress update for this task. Mention status, recent activity, blockers, next action, and due-date risk if relevant.",
    },
    {
      label: "Improve Criteria",
      icon: ListChecks,
      prompt: "Suggest improved acceptance criteria and definition of done for this task. Use concise checkbox-style items that are specific and testable.",
    },
    {
      label: "Next Step",
      icon: Target,
      prompt: "Based on everything you know about this task — its status, blockers, risk, acceptance criteria progress, and due date — what is the single most important next action to move this task forward?",
    },
  ];

  const addBlocker = async () => {
    if (!selectedBlockerId || !onAddDependency) return;
    setSavingDependency(selectedBlockerId);
    setDependencyError(null);
    try {
      await onAddDependency(task.id, selectedBlockerId);
      setSelectedBlockerId("");
    } catch (err) {
      setDependencyError(err instanceof Error ? err.message : "Could not add blocker");
    } finally {
      setSavingDependency(null);
    }
  };

  const removeBlocker = async (blockerId: string) => {
    if (!onRemoveDependency) return;
    setSavingDependency(blockerId);
    setDependencyError(null);
    try {
      await onRemoveDependency(task.id, blockerId);
    } catch (err) {
      setDependencyError(err instanceof Error ? err.message : "Could not remove blocker");
    } finally {
      setSavingDependency(null);
    }
  };

  const mentionedUserIds = (text: string): string[] => {
    const lower = text.toLowerCase();
    return members
      .filter((member) => {
        const name = (member.full_name ?? "").toLowerCase();
        const emailName = member.email.split("@")[0].toLowerCase();
        return (name && lower.includes(`@${name}`)) || lower.includes(`@${emailName}`);
      })
      .map((member) => member.user_id);
  };

  const addComment = async () => {
    if (!commentText.trim() || savingComment) return;
    setSavingComment(true);
    setCollabError(null);
    try {
      const { comment } = await api.tasks.addComment(task.id, {
        user_id: currentUserId ?? null,
        content: commentText.trim(),
        mentioned_user_ids: mentionedUserIds(commentText),
      });
      setComments((current) => [...current, comment]);
      setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId ?? null, activity_type: "comment_added", summary: "Added a comment", metadata: {}, created_at: new Date().toISOString() }, ...current]);
      onTaskUpdated?.({ ...task, latest_activity_at: new Date().toISOString() });
      setCommentText("");
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : "Could not add comment");
    } finally {
      setSavingComment(false);
    }
  };

  const saveCommentEdit = async (commentId: string) => {
    if (!editingText.trim()) return;
    setSavingComment(true);
    try {
      const { comment } = await api.tasks.updateComment(task.id, commentId, { user_id: currentUserId ?? null, content: editingText.trim() });
      setComments((current) => current.map((item) => item.id === commentId ? comment : item));
      setEditingCommentId(null);
      setEditingText("");
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : "Could not edit comment");
    } finally {
      setSavingComment(false);
    }
  };

  const deleteComment = async (commentId: string) => {
    await api.tasks.deleteComment(task.id, commentId, currentUserId ?? null);
    setComments((current) => current.filter((item) => item.id !== commentId));
  };

  const uploadAttachment = async (file: File) => {
    setUploadingAttachment(true);
    setCollabError(null);
    try {
      const { attachment } = await api.tasks.uploadAttachment(task.id, file, currentUserId ?? null);
      setAttachments((current) => [attachment, ...current]);
      setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId ?? null, activity_type: "file_uploaded", summary: `Uploaded ${file.name}`, metadata: {}, created_at: new Date().toISOString() }, ...current]);
      onTaskUpdated?.({ ...task, latest_activity_at: new Date().toISOString() });
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : "Could not upload file");
    } finally {
      setUploadingAttachment(false);
    }
  };

  const updatePriority = async (priorityValue: string) => {
    if (priorityValue === task.priority) return;
    setSavingPriority(true);
    setCollabError(null);
    try {
      await api.tasks.updatePriority(task.id, priorityValue, currentUserId ?? null);
      onTaskUpdated?.({ ...task, priority: priorityValue, latest_activity_at: new Date().toISOString() });
      setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId ?? null, activity_type: "priority_changed", summary: `Changed priority to ${priorityValue}`, metadata: {}, created_at: new Date().toISOString() }, ...current]);
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : "Could not update priority");
    } finally {
      setSavingPriority(false);
    }
  };

  const saveQuality = async (nextAcceptance = acceptanceCriteria, nextDone = definitionOfDone) => {
    setSavingQuality(true);
    setCollabError(null);
    try {
      const { task: updated } = await api.tasks.updateQuality(task.id, {
        acceptance_criteria: nextAcceptance,
        definition_of_done: nextDone,
        user_id: currentUserId ?? null,
      });
      onTaskUpdated?.({ ...task, ...updated, latest_activity_at: new Date().toISOString() });
      setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId ?? null, activity_type: "quality_updated", summary: "Updated acceptance criteria", metadata: {}, created_at: new Date().toISOString() }, ...current]);
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : "Could not update acceptance criteria");
    } finally {
      setSavingQuality(false);
    }
  };

  const updateQualityItem = (kind: "acceptance" | "done", itemId: string, patch: Partial<TaskChecklistItem>) => {
    const nextAcceptance = kind === "acceptance"
      ? acceptanceCriteria.map((item) => item.id === itemId ? { ...item, ...patch } : item)
      : acceptanceCriteria;
    const nextDone = kind === "done"
      ? definitionOfDone.map((item) => item.id === itemId ? { ...item, ...patch } : item)
      : definitionOfDone;
    onTaskUpdated?.({ ...task, acceptance_criteria: nextAcceptance, definition_of_done: nextDone });
    saveQuality(nextAcceptance, nextDone);
  };

  const addQualityItem = (kind: "acceptance" | "done") => {
    const next = newChecklistItem(kind === "acceptance" ? "New acceptance criterion" : "New done check");
    const nextAcceptance = kind === "acceptance" ? [...acceptanceCriteria, next] : acceptanceCriteria;
    const nextDone = kind === "done" ? [...definitionOfDone, next] : definitionOfDone;
    onTaskUpdated?.({ ...task, acceptance_criteria: nextAcceptance, definition_of_done: nextDone });
    saveQuality(nextAcceptance, nextDone);
  };

  const removeQualityItem = (kind: "acceptance" | "done", itemId: string) => {
    const nextAcceptance = kind === "acceptance" ? acceptanceCriteria.filter((item) => item.id !== itemId) : acceptanceCriteria;
    const nextDone = kind === "done" ? definitionOfDone.filter((item) => item.id !== itemId) : definitionOfDone;
    onTaskUpdated?.({ ...task, acceptance_criteria: nextAcceptance, definition_of_done: nextDone });
    saveQuality(nextAcceptance, nextDone);
  };

  const improveQuality = async () => {
    setImprovingQuality(true);
    setCollabError(null);
    try {
      const { response } = await api.ai.chat({
        message: "Return JSON only with acceptance_criteria and definition_of_done arrays. Make each item specific, testable, concise, and practical for this software task. Improve vague criteria if present.",
        context: `Task: ${task.title}\nDescription: ${task.description ?? ""}\nTech: ${(task.assigned_tech ?? []).join(", ")}\nCurrent acceptance criteria: ${acceptanceCriteria.map((item) => item.text).join("; ")}\nCurrent definition of done: ${definitionOfDone.map((item) => item.text).join("; ")}`,
      });
      const parsed = parseQualityJson(response);
      if (!parsed || (parsed.acceptance_criteria.length === 0 && parsed.definition_of_done.length === 0)) {
        throw new Error("AI did not return usable criteria. Try again.");
      }
      const nextAcceptance = parsed.acceptance_criteria.slice(0, 6).map((text) => newChecklistItem(text));
      const nextDone = parsed.definition_of_done.slice(0, 5).map((text) => newChecklistItem(text));
      onTaskUpdated?.({ ...task, acceptance_criteria: nextAcceptance, definition_of_done: nextDone });
      await saveQuality(nextAcceptance, nextDone);
    } catch (err) {
      setCollabError(err instanceof Error ? err.message : "Could not improve criteria");
    } finally {
      setImprovingQuality(false);
    }
  };

  const addGithubLink = async () => {
    if (!githubRepository || githubLoading) return;
    if (!githubIssueInput.trim() && !githubBranchInput.trim() && !githubPrInput.trim()) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      const { link } = await api.github.addTaskLink(task.id, {
        issue_number: githubIssueInput.trim() || null,
        branch_name: githubBranchInput.trim() || null,
        pull_request_number: githubPrInput.trim() || null,
        created_by: currentUserId ?? null,
      });
      setGithubLinks((current) => [link, ...current]);
      setGithubIssueInput("");
      setGithubBranchInput("");
      setGithubPrInput("");
      setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId ?? null, activity_type: "github_linked", summary: "Linked GitHub work", metadata: {}, created_at: new Date().toISOString() }, ...current]);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not link GitHub work");
    } finally {
      setGithubLoading(false);
    }
  };

  const removeGithubLink = async (linkId: string) => {
    setGithubLoading(true);
    setGithubError(null);
    try {
      await api.github.removeTaskLink(task.id, linkId);
      setGithubLinks((current) => current.filter((link) => link.id !== linkId));
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not remove GitHub link");
    } finally {
      setGithubLoading(false);
    }
  };

  const createGithubIssue = async () => {
    if (!githubRepository || githubLoading) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      const { link } = await api.github.createIssueFromTask(task.id, currentUserId ?? null);
      setGithubLinks((current) => [link, ...current]);
      setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId ?? null, activity_type: "github_issue_created", summary: `Created GitHub issue #${link.issue_number}`, metadata: {}, created_at: new Date().toISOString() }, ...current]);
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not create GitHub issue");
    } finally {
      setGithubLoading(false);
    }
  };

  const syncGithubActivity = async () => {
    if (!githubRepository || githubLoading) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      const data = await api.github.syncTask(task.id, currentUserId ?? null);
      setGithubCommits(data.commits);
      setGithubPrs(data.pull_requests);
      setGithubLinks(data.links);
      const now = new Date().toISOString();
      if (data.pull_requests.length > 0) {
        setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId ?? null, activity_type: "github_synced", summary: "Synced GitHub activity", metadata: {}, created_at: now }, ...current]);
      }
    } catch (err) {
      setGithubError(err instanceof Error ? err.message : "Could not sync GitHub activity");
    } finally {
      setGithubLoading(false);
    }
  };

  const syncCalendar = async (eventType: "due_date" | "work_block") => {
    if (!currentUserId || !calendarConnection || calendarLoading) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      if (schedule && (!task.start_date || !task.end_date)) {
        const start = toDateInput(schedule.start);
        const end = toDateInput(schedule.end);
        await api.tasks.updateSchedule(task.id, {
          start_date: task.start_date ?? start,
          end_date: task.end_date ?? end,
          estimated_days: task.estimated_days,
          user_id: currentUserId,
        });
        onTaskUpdated?.({ ...task, start_date: task.start_date ?? start, end_date: task.end_date ?? end, latest_activity_at: new Date().toISOString() });
      }
      const { events } = await api.calendar.syncTask(task.id, {
        user_id: currentUserId,
        event_type: eventType,
        create_work_block: eventType === "due_date" && calendarConnection.create_work_blocks,
      });
      onCalendarEventsChange?.(events);
      setActivity((current) => [{ id: `local-${Date.now()}`, task_id: task.id, user_id: currentUserId, activity_type: "calendar_synced", summary: "Synced task to calendar", metadata: {}, created_at: new Date().toISOString() }, ...current]);
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Could not sync calendar");
    } finally {
      setCalendarLoading(false);
    }
  };

  const disableCalendarSync = async () => {
    if (!currentUserId || calendarLoading) return;
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      await api.calendar.disableTask(task.id, { user_id: currentUserId });
      onCalendarEventsChange?.(calendarEvents.map((event) => ({ ...event, sync_enabled: false })));
    } catch (err) {
      setCalendarError(err instanceof Error ? err.message : "Could not disable calendar sync");
    } finally {
      setCalendarLoading(false);
    }
  };

  const refreshTime = async () => {
    const data = await api.time.task(task.id, currentUserId ?? null);
    setTimeEntries(data.entries);
    setActiveTimer(data.active_timer);
    setTotalMinutes(data.total_minutes);
    setTimeAccuracy(data.estimate_accuracy);
    onTimeChanged?.();
  };

  const toggleTimer = async () => {
    if (timeLoading) return;
    setTimeLoading(true);
    setTimeError(null);
    try {
      if (activeTimer) await api.time.stopTimer(task.id, currentUserId ?? null);
      else await api.time.startTimer(task.id, { user_id: currentUserId ?? null });
      await refreshTime();
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "Could not update timer");
    } finally {
      setTimeLoading(false);
    }
  };

  const addManualTime = async () => {
    const minutes = Math.round(Number(manualMinutes));
    if (!minutes || minutes < 1 || timeLoading) return;
    setTimeLoading(true);
    setTimeError(null);
    try {
      await api.time.addManual(task.id, { user_id: currentUserId ?? null, minutes, note: manualNote.trim() || undefined });
      setManualMinutes("");
      setManualNote("");
      await refreshTime();
    } catch (err) {
      setTimeError(err instanceof Error ? err.message : "Could not add time");
    } finally {
      setTimeLoading(false);
    }
  };

  const handleCompleteClick = () => {
    if (!isDone && incompleteQualityCount > 0) {
      const ok = window.confirm(`${incompleteQualityCount} acceptance/done check${incompleteQualityCount === 1 ? " is" : "s are"} still unchecked. Mark this task Done anyway?`);
      if (!ok) return;
    }
    onComplete(task.id, !isDone);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-5 border-b border-purple-500/25 app-surface-soft">
        <button onClick={onBack} className="flex items-center gap-2 text-sm app-muted hover:app-text mb-3 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to AI Assistant
        </button>
        <h3 className="text-xl font-semibold app-text mb-3 leading-snug">{task.title}</h3>
        {task.is_blocked && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
            <span>Blocked by {unfinishedBlockers.map((item) => item.title).join(", ")}</span>
          </div>
        )}
        {(() => {
          const canComplete = task.assigned_to !== null && task.assigned_to === currentUserId;
          return (
            <motion.button
              whileHover={canComplete ? { scale: 1.02 } : {}}
              whileTap={canComplete ? { scale: 0.97 } : {}}
              onClick={() => canComplete && handleCompleteClick()}
              title={!canComplete ? "Only the assigned user can complete this task" : undefined}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border transition-all ${isDone
                ? "bg-green-900/40 border-green-500/50 text-green-300 hover:bg-green-900/60"
                : canComplete
                  ? "app-surface-soft border-white/15 app-muted hover:border-purple-500/50 hover:bg-purple-900/20"
                  : "app-surface-soft border-white/10 app-subtle cursor-not-allowed"
                }`}
            >
              {isDone ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
              {isDone ? "Completed" : "Mark Complete"}
            </motion.button>
          );
        })()}
      </div>

      {/* Task detail scroll area — independent from chat */}
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
        {/* Suggested next action */}
        {suggestedNextAction && (
          <div className={`flex items-start gap-3 rounded-xl border p-3 ${suggestedNextAction.type === 'blocked' || suggestedNextAction.type === 'unassigned'
            ? 'border-red-500/30 bg-red-900/15' :
            suggestedNextAction.type === 'overdue'
              ? 'border-orange-500/30 bg-orange-900/15' :
              suggestedNextAction.type === 'risk'
                ? 'border-yellow-500/30 bg-yellow-900/15' :
                suggestedNextAction.type === 'criteria'
                  ? 'border-purple-500/30 bg-purple-900/15' :
                  'border-green-500/30 bg-green-900/15'
            }`}>
            <Target className={`mt-0.5 h-4 w-4 shrink-0 ${suggestedNextAction.type === 'blocked' || suggestedNextAction.type === 'unassigned' ? 'text-red-400' :
              suggestedNextAction.type === 'overdue' ? 'text-orange-400' :
                suggestedNextAction.type === 'risk' ? 'text-yellow-400' :
                  suggestedNextAction.type === 'criteria' ? 'text-purple-400' :
                    'text-green-400'
              }`} />
            <div className="min-w-0 flex-1">
            <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide app-subtle">Suggested Next Action</div>
              <p className="text-sm app-muted leading-snug">{suggestedNextAction.text}</p>
            </div>
            <button
              type="button"
              onClick={() => sendPrompt(`Give me specific guidance: ${suggestedNextAction.text}`, 'What should I do?')}
              className="shrink-0 self-center rounded-lg border app-border px-2.5 py-1.5 text-xs app-muted hover:border-purple-500/40 hover:text-purple-600 transition-colors"
            >
              Ask AI
            </button>
          </div>
        )}

        {/* Schedule */}
        {(schedule || task.start_date) && (
          <div className="p-3 rounded-xl app-surface-soft border app-border">
            {editingSchedule ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs app-muted mb-1">
                  <CalendarIcon className="w-3.5 h-3.5 text-purple-400" /> Edit timeframe
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="date" value={schedStart} onChange={e => setSchedStart(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1.5 app-input border border-purple-500/40 rounded-lg text-sm focus:outline-none focus:border-purple-400" />
                  <span className="app-subtle text-xs">→</span>
                  <input type="date" value={schedEnd} onChange={e => setSchedEnd(e.target.value)}
                    className="flex-1 min-w-0 px-2 py-1.5 app-input border border-purple-500/40 rounded-lg text-sm focus:outline-none focus:border-purple-400" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setEditingSchedule(false)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg border app-border text-xs app-muted hover:app-text transition-colors">
                    <X className="w-3 h-3" /> Cancel
                  </button>
                  <button onClick={saveSchedule} disabled={savingSchedule || !schedStart || !schedEnd}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-xs text-white font-semibold transition-colors disabled:opacity-50">
                    {savingSchedule ? <div className="w-3 h-3 border border-white/50 border-t-white rounded-full animate-spin" /> : <Check className="w-3 h-3" />}
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <CalendarIcon className="w-4 h-4 text-purple-400 shrink-0" />
                  <div className="flex-1 text-sm">
                    <span className="app-muted">Schedule: </span>
                    <span className="app-text">
                      {schedule ? `${formatDate(schedule.start)} → ${formatDate(schedule.end)}` : `${task.start_date} → ${task.end_date}`}
                    </span>
                  </div>
                  <button onClick={openScheduleEdit} disabled={!canEditTasks} className="shrink-0 p-1 rounded-md app-muted hover:text-purple-300 hover:app-surface-soft transition-colors disabled:opacity-30" title="Edit schedule">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                {schedule?.hasDependencyWarning && (
                  <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-100">
                    <AlertTriangle className="h-3.5 w-3.5 text-yellow-300" />
                    {schedule.warning ?? "Schedule warning"}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Priority + Days */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${priority.bg} ${priority.text}`}>
            {priority.label}
          </span>
          <select
            value={task.priority}
            onChange={(e) => updatePriority(e.target.value)}
            disabled={savingPriority || !canEditTasks}
            className="rounded-lg border app-border app-input px-2 py-1.5 text-xs app-muted outline-none focus:border-purple-500/60 disabled:opacity-40"
          >
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          {onStatusChange && (
            <StatusSelect status={task.status} disabled={!canEditTasks} onChange={(status) => onStatusChange(task.id, status)} />
          )}
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs app-surface-soft border app-border app-muted">
            <Clock className="w-3 h-3" /> {task.estimated_days}d
          </span>
        </div>

        {/* Task Objective */}
        {(summary || steps.length > 0) && (
          <div className="space-y-3 rounded-xl border app-border app-surface-soft p-3">
            <div className="flex items-center gap-2 text-sm font-semibold app-muted">
              <Target className="h-4 w-4 text-purple-400" /> Objective
            </div>
            {summary && <p className="text-sm app-muted leading-relaxed">{summary}</p>}
            {steps.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide app-subtle">Implementation Steps</div>
                {steps.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg app-surface-soft border app-border text-sm app-muted">
                    <span className="shrink-0 flex items-center justify-center w-5 h-5 rounded-md bg-purple-900/50 text-[10px] font-bold text-purple-300">{i + 1}</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={`space-y-3 rounded-xl border p-3 ${riskStyle(taskRisk.level)}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle className="h-4 w-4" /> Task Risk
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-semibold">{taskRisk.level}</span>
              <span className="text-[10px] opacity-60">{taskRisk.score}/100</span>
            </div>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">Reasons</div>
            <ul className="space-y-1 text-xs leading-5">
              {taskRisk.reasons.slice(0, 4).map((reason) => <li key={reason}>- {reason}</li>)}
            </ul>
          </div>
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide opacity-70">Actions</div>
            <ul className="space-y-1 text-xs leading-5">
              {taskRisk.actions.slice(0, 3).map((action) => <li key={action}>- {action}</li>)}
            </ul>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border app-border app-surface-soft p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold app-text">
              <Timer className="h-4 w-4 text-purple-400" /> Time Tracking
            </div>
            <span className="rounded-full border app-border app-surface-soft px-2 py-1 text-[10px] app-subtle">Optional</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg border app-border app-surface-soft p-2">
              <div className="text-[10px] app-subtle">Actual</div>
              <div className="text-sm font-semibold app-text">{formatMinutes(totalMinutes)}</div>
            </div>
            <div className="rounded-lg border app-border app-surface-soft p-2">
              <div className="text-[10px] app-subtle">Estimate</div>
              <div className="text-sm font-semibold app-text">{formatMinutes(Math.round(task.estimated_days * 8 * 60))}</div>
            </div>
            <div className="rounded-lg border app-border app-surface-soft p-2">
              <div className="text-[10px] app-subtle">Accuracy</div>
              <div className="text-sm font-semibold app-text">{timeAccuracy === null ? "-" : `${timeAccuracy}%`}</div>
            </div>
          </div>
          {timeError && <p className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{timeError}</p>}
          <button
            onClick={toggleTimer}
            disabled={timeLoading}
            className={`w-full rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 ${activeTimer ? "border border-red-500/30 bg-red-900/20 text-red-200 hover:bg-red-900/35" : "border border-purple-500/30 bg-purple-900/20 text-purple-100 hover:bg-purple-900/35"}`}
          >
            {timeLoading ? "Saving..." : activeTimer ? "Stop timer" : "Start timer"}
          </button>
          <div className="grid gap-2 sm:grid-cols-[90px_1fr_auto]">
            <input
              value={manualMinutes}
              onChange={(e) => setManualMinutes(e.target.value)}
              type="number"
              min="1"
              placeholder="Min"
              className="rounded-lg border app-border app-input px-3 py-2 text-xs outline-none focus:border-purple-500/50"
            />
            <input
              value={manualNote}
              onChange={(e) => setManualNote(e.target.value)}
              placeholder="Note for planning or billing"
              className="rounded-lg border app-border app-input px-3 py-2 text-xs outline-none focus:border-purple-500/50"
            />
            <button onClick={addManualTime} disabled={timeLoading || !manualMinutes} className="rounded-lg border app-border px-3 py-2 text-xs app-muted hover:border-purple-500/40 disabled:opacity-40">
              Add
            </button>
          </div>
          {timeEntries.length > 0 && (
            <div className="space-y-1 border-t app-border pt-2">
              {timeEntries.slice(0, 3).map((entry) => (
                <div key={entry.id} className="flex items-center justify-between gap-2 text-xs app-subtle">
                  <span>{entry.source === "timer" ? "Timer" : "Manual"} {entry.note ? `- ${entry.note}` : ""}</span>
                  <span>{formatMinutes(entry.minutes)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Assignee */}
        <div className="flex items-center gap-3 p-3 rounded-xl app-surface-soft border app-border">
          <UserIcon className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="text-sm app-muted">
            {assignee ? (assignee.full_name ?? assignee.email) : "Unassigned"}
          </span>
        </div>

        {/* Dependencies */}
        <div className="space-y-3 rounded-xl border app-border app-surface-soft p-3">
          <div className="flex items-center gap-2 text-sm font-semibold app-muted">
            <Link2 className="h-4 w-4 text-purple-400" /> Blocked by
          </div>
          {(task.blocked_by ?? []).length === 0 ? (
            <p className="text-xs app-subtle">No blockers</p>
          ) : (
            <div className="space-y-2">
              {(task.blocked_by ?? []).map((blocker) => (
                <div key={blocker.id} className="flex items-center gap-2 rounded-lg border app-border app-surface-soft px-3 py-2">
                  <span className={`h-2 w-2 rounded-full ${blocker.status === "Done" ? "bg-green-400" : "bg-red-400"}`} />
                  <span className="min-w-0 flex-1 truncate text-sm app-text">{blocker.title}</span>
                  <span className="text-[10px] app-subtle">{blocker.status}</span>
                  <button
                    onClick={() => removeBlocker(blocker.id)}
                    disabled={savingDependency === blocker.id || !canEditTasks}
                    className="rounded-md p-1 app-subtle hover:bg-red-900/30 hover:text-red-300 disabled:opacity-40"
                    aria-label={`Remove blocker ${blocker.title}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <select
              value={selectedBlockerId}
              onChange={(e) => setSelectedBlockerId(e.target.value)}
              disabled={!canEditTasks}
              className="min-w-0 flex-1 rounded-lg border app-border app-input px-2 py-2 text-xs app-muted outline-none focus:border-purple-500/60"
            >
              <option value="">Add blocker...</option>
              {availableBlockers.map((item) => (
                <option key={item.id} value={item.id}>{item.title}</option>
              ))}
            </select>
            <button
              onClick={addBlocker}
              disabled={!selectedBlockerId || savingDependency === selectedBlockerId || !canEditTasks}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-600 text-white transition-colors hover:bg-purple-500 disabled:opacity-40"
              aria-label="Add blocker"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {dependencyError && <p className="text-xs text-red-300">{dependencyError}</p>}

          <div className="border-t app-border pt-3">
            <div className="mb-2 text-sm font-semibold app-muted">Unlocks</div>
            {(task.unlocks ?? []).length === 0 ? (
              <p className="text-xs app-subtle">No dependent tasks</p>
            ) : (
              <div className="space-y-2">
                {(task.unlocks ?? []).map((item) => (
                  <div key={item.id} className="flex items-center gap-2 rounded-lg border app-border app-surface-soft px-3 py-2 text-sm app-text">
                    <span className={`h-2 w-2 rounded-full ${item.status === "Done" ? "bg-green-400" : "bg-purple-400"}`} />
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="text-[10px] app-subtle">{item.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Related tasks */}
        {relatedTasks.length > 0 && (
          <div className="space-y-2 rounded-xl border app-border app-surface-soft p-3">
            <div className="flex items-center gap-2 text-sm font-semibold app-muted">
              <Link2 className="h-4 w-4 text-purple-400" /> Related Tasks
            </div>
            <div className="space-y-1.5">
              {relatedTasks.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg border app-border app-surface-soft px-3 py-2 text-xs">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${item.status === 'Done' ? 'bg-green-400' : item.status === 'In Progress' ? 'bg-purple-400' : 'bg-gray-400'}`} />
                  <span className="min-w-0 flex-1 truncate app-text">{item.title}</span>
                  <span className="shrink-0 text-[10px] app-subtle">{item.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tech */}
        {(task.assigned_tech ?? []).length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-2 text-sm app-muted"><Tag className="w-3.5 h-3.5" /> Tech Stack</div>
            <div className="flex flex-wrap gap-2">
              {task.assigned_tech.map(t => (
                <span key={t} className="px-3 py-1 rounded-lg text-xs bg-purple-900/30 border border-purple-500/30 text-purple-300">{t}</span>
              ))}
            </div>
          </div>
        )}


        {/* Acceptance Criteria + Definition of Done */}
        <div className="space-y-4 rounded-xl border app-border app-surface-soft p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold app-text">Acceptance Criteria</div>
              <div className="text-[11px] app-subtle">Specific checks for correct completion</div>
            </div>
            <button
              onClick={improveQuality}
              disabled={improvingQuality || savingQuality || !canEditTasks}
              className="flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-900/20 px-2.5 py-1.5 text-xs text-purple-200 hover:bg-purple-900/35 disabled:opacity-40"
            >
              {improvingQuality ? <div className="h-3 w-3 animate-spin rounded-full border border-purple-300 border-t-transparent" /> : <Sparkles className="h-3.5 w-3.5" />}
              Improve
            </button>
          </div>

          <div className="space-y-2">
            {acceptanceCriteria.length === 0 ? (
              <p className="rounded-lg border border-dashed app-border py-3 text-center text-xs app-subtle">No criteria yet</p>
            ) : acceptanceCriteria.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border app-border app-surface-soft px-2 py-2">
                <input
                  type="checkbox"
                  checked={item.checked}
                  onChange={(e) => updateQualityItem("acceptance", item.id, { checked: e.target.checked })}
                  disabled={!canEditTasks}
                  className="h-4 w-4 accent-purple-500"
                />
                <input
                  value={item.text}
                  onChange={(e) => onTaskUpdated?.({ ...task, acceptance_criteria: acceptanceCriteria.map((current) => current.id === item.id ? { ...current, text: e.target.value } : current) })}
                  onBlur={(e) => updateQualityItem("acceptance", item.id, { text: e.target.value })}
                  disabled={!canEditTasks}
                  className="min-w-0 flex-1 bg-transparent text-sm app-text outline-none"
                />
                <button onClick={() => removeQualityItem("acceptance", item.id)} disabled={!canEditTasks} className="rounded-md p-1 app-subtle hover:bg-red-900/30 hover:text-red-500 disabled:opacity-30">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <button onClick={() => addQualityItem("acceptance")} disabled={!canEditTasks} className="flex items-center gap-2 text-xs text-purple-300 hover:text-purple-100 disabled:opacity-30">
              <Plus className="h-3.5 w-3.5" /> Add criterion
            </button>
          </div>

          <div className="border-t app-border pt-4">
            <div className="mb-2 text-sm font-semibold app-text">Definition of Done</div>
            <div className="space-y-2">
              {definitionOfDone.length === 0 ? (
                <p className="rounded-lg border border-dashed app-border py-3 text-center text-xs app-subtle">No done checks yet</p>
              ) : definitionOfDone.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg border app-border app-surface-soft px-2 py-2">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) => updateQualityItem("done", item.id, { checked: e.target.checked })}
                    disabled={!canEditTasks}
                    className="h-4 w-4 accent-purple-500"
                  />
                  <input
                    value={item.text}
                    onChange={(e) => onTaskUpdated?.({ ...task, definition_of_done: definitionOfDone.map((current) => current.id === item.id ? { ...current, text: e.target.value } : current) })}
                    onBlur={(e) => updateQualityItem("done", item.id, { text: e.target.value })}
                    disabled={!canEditTasks}
                    className="min-w-0 flex-1 bg-transparent text-sm app-text outline-none"
                  />
                  <button onClick={() => removeQualityItem("done", item.id)} disabled={!canEditTasks} className="rounded-md p-1 app-subtle hover:bg-red-900/30 hover:text-red-500 disabled:opacity-30">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button onClick={() => addQualityItem("done")} disabled={!canEditTasks} className="flex items-center gap-2 text-xs text-purple-300 hover:text-purple-100 disabled:opacity-30">
                <Plus className="h-3.5 w-3.5" /> Add done check
              </button>
            </div>
          </div>
          {savingQuality && <p className="text-[11px] app-subtle">Saving criteria...</p>}
        </div>

        {/* Completed by */}
        {isDone && task.completed_at && (
          <div className="p-3 rounded-xl bg-green-900/20 border border-green-500/20 text-sm text-green-300">
            ✓ Completed{task.completer_name ? ` by ${task.completer_name}` : ""} on {formatDate(new Date(task.completed_at))}
          </div>
        )}

        <div className="space-y-3 rounded-xl border app-border app-surface-soft p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold app-text">
              <CalendarPlus className="h-4 w-4 text-purple-400" /> Calendar
            </div>
            {calendarConnection ? (
              <span className="rounded-full border border-green-500/30 bg-green-900/20 px-2 py-1 text-[10px] text-green-300">
                {calendarConnection.sync_enabled ? "Sync ready" : "Sync off"}
              </span>
            ) : (
              <span className="rounded-full border app-border px-2 py-1 text-[10px] app-subtle">Not connected</span>
            )}
          </div>

          {calendarConnection ? (
            <div className="space-y-3">
              <div className="rounded-lg border app-border app-surface-soft p-2 text-xs app-muted">
                {calendarConnection.calendar_name ?? "Google Calendar"} · {calendarConnection.timezone ?? "UTC"}
              </div>
              {calendarError && <p className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{calendarError}</p>}
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  onClick={() => syncCalendar("due_date")}
                  disabled={calendarLoading || !calendarConnection.sync_enabled || !(task.end_date || schedule)}
                  className="rounded-lg border border-purple-500/30 bg-purple-900/20 px-3 py-2 text-xs font-semibold text-purple-100 hover:bg-purple-900/35 disabled:opacity-40"
                >
                  {calendarLoading ? "Syncing..." : "Sync due date"}
                </button>
                <button
                  onClick={() => syncCalendar("work_block")}
                  disabled={calendarLoading || !calendarConnection.sync_enabled || !(task.start_date || task.end_date || schedule)}
                  className="rounded-lg border app-border app-surface-soft px-3 py-2 text-xs font-semibold app-muted hover:border-purple-500/40 disabled:opacity-40"
                >
                  Create work block
                </button>
              </div>
              {calendarEvents.length > 0 && (
                <div className="space-y-2">
                  {calendarEvents.map((event) => (
                    <div key={event.id} className="rounded-lg border app-border app-surface-soft p-2 text-xs app-muted">
                      <div className="flex items-center justify-between gap-2">
                        <span>{event.event_type === "due_date" ? "Due date" : "Work block"}</span>
                        <span className={event.sync_status === "synced" ? "text-green-600" : event.sync_status === "error" ? "text-red-600" : "app-subtle"}>
                          {event.sync_enabled ? event.sync_status ?? "pending" : "disabled"}
                        </span>
                      </div>
                      {event.last_synced_at && <div className="mt-1 app-subtle">Synced {formatCompactDate(event.last_synced_at)}</div>}
                      {event.last_error && <div className="mt-1 text-red-300">{event.last_error}</div>}
                    </div>
                  ))}
                  <button onClick={disableCalendarSync} disabled={calendarLoading} className="text-xs app-subtle hover:text-red-300 disabled:opacity-40">
                    Disable sync for this task
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed app-border py-3 text-center text-xs app-subtle">Connect Google Calendar on the project page to sync this task.</p>
          )}
        </div>

        <div className="space-y-4 rounded-xl border app-border app-surface-soft p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold app-text">
              <Github className="h-4 w-4 text-purple-400" /> GitHub
            </div>
            {githubRepository ? (
              <div className="flex gap-2">
                <button
                  onClick={syncGithubActivity}
                  disabled={githubLoading}
                  className="inline-flex items-center gap-1.5 rounded-lg border app-border app-surface-soft px-2.5 py-1.5 text-xs app-muted hover:border-purple-500/40 disabled:opacity-40"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${githubLoading ? "animate-spin" : ""}`} /> Sync
                </button>
                <button
                  onClick={createGithubIssue}
                  disabled={githubLoading}
                  className="rounded-lg border border-purple-500/30 bg-purple-900/20 px-2.5 py-1.5 text-xs text-purple-200 hover:bg-purple-900/35 disabled:opacity-40"
                >
                  Create issue
                </button>
              </div>
            ) : (
              <span className="rounded-full border app-border px-2 py-1 text-[10px] app-subtle">Not connected</span>
            )}
          </div>

          {githubRepository ? (
            <div className="space-y-3">
              <div className="rounded-lg border app-border app-surface-soft p-2 text-xs app-muted">
                Connected to <span className="app-text">{githubRepository.owner}/{githubRepository.repo}</span>
              </div>
              {githubError && <p className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{githubError}</p>}
              <div className="grid gap-2">
                <input
                  value={githubIssueInput}
                  onChange={(e) => setGithubIssueInput(e.target.value)}
                  placeholder="Issue number"
                  className="rounded-lg border app-border app-input px-3 py-2 text-xs outline-none focus:border-purple-500/50"
                />
                <input
                  value={githubBranchInput}
                  onChange={(e) => setGithubBranchInput(e.target.value)}
                  placeholder="Branch name"
                  className="rounded-lg border app-border app-input px-3 py-2 text-xs outline-none focus:border-purple-500/50"
                />
                <input
                  value={githubPrInput}
                  onChange={(e) => setGithubPrInput(e.target.value)}
                  placeholder="Pull request number"
                  className="rounded-lg border app-border app-input px-3 py-2 text-xs outline-none focus:border-purple-500/50"
                />
                <button
                  onClick={addGithubLink}
                  disabled={githubLoading || (!githubIssueInput.trim() && !githubBranchInput.trim() && !githubPrInput.trim())}
                  className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40"
                >
                  Link GitHub work
                </button>
              </div>

              {githubLinks.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold app-muted">Linked work</div>
                  {githubLinks.map((link) => (
                    <div key={link.id} className="rounded-lg border app-border app-surface-soft p-2 text-xs app-muted">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          {link.issue_number && (
                            <a href={link.issue_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-purple-200">
                              <Github className="h-3.5 w-3.5" /> Issue #{link.issue_number} <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                          {link.branch_name && <div className="flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" /> {link.branch_name}</div>}
                          {link.pull_request_number && (
                            <a href={link.pull_request_url ?? undefined} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-purple-200">
                              <GitPullRequest className="h-3.5 w-3.5" /> PR #{link.pull_request_number}
                              {link.last_pr_merged ? " merged" : link.last_pr_state ? ` ${link.last_pr_state}` : ""}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                        <button onClick={() => removeGithubLink(link.id)} disabled={githubLoading} className="rounded-md p-1 app-subtle hover:bg-red-900/30 hover:text-red-300">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(githubCommits.length > 0 || githubPrs.length > 0) && (
                <div className="space-y-3 border-t app-border pt-3">
                  {githubPrs.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold app-muted">Pull requests</div>
                      {githubPrs.slice(0, 5).map((pr) => (
                        <a key={pr.number} href={pr.url} target="_blank" rel="noreferrer" className="block rounded-lg border app-border app-surface-soft p-2 text-xs app-muted hover:border-purple-500/40">
                          <span className="font-semibold app-text">#{pr.number}</span> {pr.title}
                          <span className="ml-2 app-subtle">{pr.merged ? "merged" : pr.state}</span>
                        </a>
                      ))}
                    </div>
                  )}
                  {githubCommits.length > 0 && (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold app-muted">Commits</div>
                      {githubCommits.slice(0, 5).map((commit) => (
                        <a key={commit.sha} href={commit.url} target="_blank" rel="noreferrer" className="block rounded-lg border app-border app-surface-soft p-2 text-xs app-muted hover:border-purple-500/40">
                          <span className="font-mono text-purple-300">{commit.sha.slice(0, 7)}</span> {commit.message?.split("\n")[0]}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed app-border py-3 text-center text-xs app-subtle">Connect a repository on the project page to link code activity.</p>
          )}
        </div>

        {/* Human collaboration */}
        <div className="space-y-4 rounded-xl border app-border app-surface-soft p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold app-text">
              <MessageSquare className="h-4 w-4 text-purple-400" /> Comments
            </div>
            <label className={`inline-flex items-center gap-1.5 rounded-lg border app-border app-surface-soft px-2.5 py-1.5 text-xs app-muted hover:border-purple-500/40 ${canUploadFiles ? "cursor-pointer" : "cursor-not-allowed opacity-40"}`}>
              {uploadingAttachment ? <div className="h-3 w-3 animate-spin rounded-full border border-purple-400 border-t-transparent" /> : <Upload className="h-3.5 w-3.5" />}
              Attach
              <input
                type="file"
                disabled={!canUploadFiles}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadAttachment(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>

          {collabError && <p className="rounded-lg border border-red-500/30 bg-red-900/20 px-3 py-2 text-xs text-red-200">{collabError}</p>}

          <div className="space-y-2">
            <textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={3}
              placeholder='Write a comment... use @name to mention someone'
              className="w-full resize-none rounded-xl border app-border app-input px-3 py-2 text-sm outline-none focus:border-purple-500/50"
            />
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-[10px] app-subtle">
                {members.slice(0, 3).map((m) => `@${(m.full_name ?? m.email.split("@")[0]).split(" ")[0]}`).join("  ")}
              </div>
              <button
                onClick={addComment}
                disabled={!commentText.trim() || savingComment}
                className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-40"
              >
                {savingComment ? "Posting..." : "Comment"}
              </button>
            </div>
          </div>

          {collabLoading ? (
            <p className="py-4 text-center text-xs app-subtle">Loading comments...</p>
          ) : comments.length === 0 ? (
            <p className="rounded-lg border border-dashed app-border py-4 text-center text-xs app-subtle">No human comments yet</p>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => {
                const isOwn = comment.user_id && comment.user_id === currentUserId;
                const isEditing = editingCommentId === comment.id;
                return (
                  <div key={comment.id} className="rounded-xl border app-border app-surface-soft p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold app-text">{displayUser(comment.users)}</div>
                        <div className="text-[10px] app-subtle">{formatCompactDate(comment.created_at)}{comment.edited_at ? " · edited" : ""}</div>
                      </div>
                      {isOwn && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setEditingCommentId(comment.id); setEditingText(comment.content); }} className="rounded-md p-1 app-subtle hover:app-surface-soft hover:app-text">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => deleteComment(comment.id)} className="rounded-md p-1 app-subtle hover:bg-red-900/30 hover:text-red-300">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} rows={2} className="w-full resize-none rounded-lg border app-border app-input px-3 py-2 text-sm outline-none focus:border-purple-500/50" />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingCommentId(null)} className="text-xs app-subtle hover:app-text">Cancel</button>
                          <button onClick={() => saveCommentEdit(comment.id)} className="rounded-md bg-purple-600 px-2.5 py-1 text-xs text-white">Save</button>
                        </div>
                      </div>
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed app-muted">{comment.content}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {attachments.length > 0 && (
            <div className="border-t app-border pt-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold app-muted">
                <Paperclip className="h-4 w-4 text-purple-400" /> Attachments
              </div>
              <div className="grid gap-2">
                {attachments.map((file) => (
                  <a key={file.id} href={file.file_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg border app-border app-surface-soft p-2 hover:border-purple-500/40">
                    {file.is_image ? (
                      <img src={file.file_url} alt={file.file_name} className="h-10 w-10 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-md app-surface-soft"><ImageIcon className="h-4 w-4 app-muted" /></div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm app-text">{file.file_name}</div>
                      <div className="text-[10px] app-subtle">{fileSizeLabel(file.file_size)} · {formatCompactDate(file.created_at)}</div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {activity.length > 0 && (
            <div className="border-t app-border pt-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold app-muted">
                <History className="h-4 w-4 text-purple-400" /> Activity
              </div>
              <div className="space-y-2">
                {activity.slice(0, 8).map((item) => (
                  <div key={item.id} className="flex gap-2 text-xs app-muted">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400/70" />
                    <div className="min-w-0">
                      <span className="app-text">{displayUser(item.users)}</span> {item.summary}
                      <div className="text-[10px] app-subtle">{formatCompactDate(item.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI Chat — resizable section, drag the handle up/down to resize */}
      <div className="shrink-0 flex flex-col" style={{ height: chatHeight }}>
        {/* Drag handle */}
        <div
          onMouseDown={e => startDrag(e.clientY)}
          onTouchStart={e => startDrag(e.touches[0].clientY)}
          className="shrink-0 flex flex-col items-center justify-center h-4 cursor-ns-resize border-t border-purple-500/30 hover:border-purple-400/60 group transition-colors select-none"
        >
          <div className="flex gap-1 mt-0.5">
            <div className="w-6 h-0.5 rounded-full bg-purple-500/40 group-hover:bg-purple-400/80 transition-colors" />
            <div className="w-3 h-0.5 rounded-full bg-purple-500/25 group-hover:bg-purple-400/50 transition-colors" />
          </div>
        </div>

        {/* Chat header */}
        <div className="flex items-center gap-2 px-4 pt-2 pb-2 shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-xs font-semibold app-muted truncate">AI Chat — {task.title}</span>
        </div>

        <div className="shrink-0 px-4 pb-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => sendPrompt(action.prompt, action.label)}
                  disabled={sending}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border app-border app-input px-2.5 py-1.5 text-[11px] font-medium app-muted transition-colors hover:border-purple-400/50 hover:bg-purple-500/15 disabled:opacity-50"
                >
                  <Icon className="h-3 w-3 text-purple-300" />
                  {action.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Messages — scroll independently */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 space-y-2 pb-2">
          {chat.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[88%] p-2.5 rounded-xl text-sm ${m.role === "user"
                ? "bg-linear-to-br from-purple-600 to-purple-900 text-white"
                : "app-input border app-border app-muted"
                }`}>
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{m.content}</pre>
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="app-surface-soft rounded-xl p-3 flex gap-1.5">
                {[0, 0.2, 0.4].map(d => (
                  <motion.div key={d} animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 0.8, repeat: Infinity, delay: d }} className="w-2 h-2 bg-purple-400 rounded-full" />
                ))}
              </div>
            </div>
          )}
          <div ref={chatEnd} />
        </div>

        {/* Input — always at bottom */}
        <div className="shrink-0 p-3 border-t border-purple-500/20 app-panel">
          <div className="flex items-center gap-2">
            <input
              value={message} onChange={e => setMessage(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMsg()}
              placeholder={`Ask about "${task.title}"...`}
              className="min-w-0 flex-1 px-3 py-2 app-input border border-purple-500/35 rounded-xl focus:outline-none focus:border-purple-400/70 text-sm"
            />
            <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }} onClick={sendMsg} disabled={sending}
              className="h-9 w-9 shrink-0 flex items-center justify-center bg-linear-to-r from-purple-600 to-purple-900 rounded-xl disabled:opacity-50">
              <Send className="w-4 h-4" />
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
}
