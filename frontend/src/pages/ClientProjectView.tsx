import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { CalendarDays, CheckCircle2, MessageSquare, Send } from "lucide-react";
import { api, type ClientPortalComment, type ClientPortalPayload, type ClientPortalTask } from "../lib/api";

const statusStyles: Record<string, string> = {
  Done: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700",
  "In Progress": "border-purple-500/30 bg-purple-500/10 text-purple-700",
  "In Review": "border-amber-500/30 bg-amber-500/10 text-amber-700",
  Backlog: "border-gray-300 bg-gray-100 text-gray-600",
  "To Do": "border-sky-500/30 bg-sky-500/10 text-sky-700",
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function taskBucket(task: ClientPortalTask): "Completed" | "Current" | "Upcoming" {
  if (task.status === "Done") return "Completed";
  if (task.status === "In Progress" || task.status === "In Review") return "Current";
  return "Upcoming";
}

function TaskRow({ task }: { task: ClientPortalTask }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-gray-950">{task.title}</div>
          <div className="mt-1 text-sm text-gray-500">{formatDate(task.start_date)} to {formatDate(task.end_date)}</div>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusStyles[task.status] ?? statusStyles.Backlog}`}>
          {task.status}
        </span>
      </div>
    </div>
  );
}

export function ClientProjectView() {
  const { token } = useParams<{ token: string }>();
  const [payload, setPayload] = useState<ClientPortalPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<ClientPortalComment[]>([]);
  const [authorName, setAuthorName] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.clientShares
      .getPublic(token)
      .then((data) => {
        setPayload(data);
        setComments(data.comments);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Client link could not be loaded"))
      .finally(() => setLoading(false));
  }, [token]);

  const groupedTasks = useMemo(() => {
    const groups = new Map<string, ClientPortalTask[]>([
      ["Current", []],
      ["Upcoming", []],
      ["Completed", []],
    ]);
    for (const task of payload?.tasks ?? []) groups.get(taskBucket(task))?.push(task);
    return groups;
  }, [payload?.tasks]);

  const postComment = async () => {
    if (!token || !authorName.trim() || !commentText.trim()) return;
    setPosting(true);
    setCommentError(null);
    try {
      const { comment } = await api.clientShares.addComment(token, {
        author_name: authorName.trim(),
        content: commentText.trim(),
      });
      setComments((current) => [...current, comment]);
      setCommentText("");
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Could not post comment");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 text-gray-600">
        <div className="mx-auto max-w-5xl">
          <div className="h-8 w-56 animate-pulse rounded bg-gray-200" />
          <div className="mt-8 h-48 animate-pulse rounded-3xl bg-gray-200" />
        </div>
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-8 text-center">
        <div className="max-w-md rounded-3xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-gray-950">Link unavailable</h1>
          <p className="mt-3 text-gray-500">{error ?? "This client project link is not active."}</p>
        </div>
      </div>
    );
  }

  const { project, share, milestones } = payload;
  const brand = share.settings.brand_label || "Project Status";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-950">
      <main className="mx-auto max-w-6xl px-5 py-8 sm:px-8 lg:py-12">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-purple-700">{brand}</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-5xl">{project.name}</h1>
          </div>
          <span className="w-fit rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-600 shadow-sm">
            {project.status}
          </span>
        </div>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <p className="max-w-3xl text-lg leading-8 text-gray-600">{project.description}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Progress</div>
              <div className="mt-2 text-3xl font-semibold">{project.progress}%</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Completed work</div>
              <div className="mt-2 text-3xl font-semibold">{project.completed_count}/{project.task_count}</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-4">
              <div className="text-sm text-gray-500">Timeline</div>
              <div className="mt-2 text-3xl font-semibold">{project.duration_weeks ?? "-"}w</div>
            </div>
          </div>
          <div className="mt-6 h-3 overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-full bg-purple-600" style={{ width: `${project.progress}%` }} />
          </div>
        </section>

        {share.settings.show_milestones && (
          <section className="mt-8">
            <div className="mb-4 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-purple-700" />
              <h2 className="text-xl font-semibold">Milestones</h2>
            </div>
            {milestones.length === 0 ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-6 text-gray-500">No shared milestones yet.</div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {milestones.map((milestone) => (
                  <div key={milestone.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{milestone.title}</div>
                        <div className="mt-1 text-sm text-gray-500">{formatDate(milestone.end_date)}</div>
                      </div>
                      {milestone.status === "Done" && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {share.settings.show_tasks && (
          <section className="mt-8">
            <h2 className="mb-4 text-xl font-semibold">Shared Tasks</h2>
            <div className="grid gap-6 lg:grid-cols-3">
              {Array.from(groupedTasks.entries()).map(([label, items]) => (
                <div key={label}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-medium text-gray-800">{label}</h3>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-500">{items.length}</span>
                  </div>
                  <div className="space-y-3">
                    {items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-sm text-gray-400">Nothing shared here.</div>
                    ) : items.map((task) => <TaskRow key={task.id} task={task} />)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {payload.risk_summary && (
          <section className="mt-8 rounded-3xl border border-amber-200 bg-amber-50 p-6">
            <h2 className="text-xl font-semibold text-amber-950">Shared Risk Note</h2>
            <p className="mt-2 text-sm leading-6 text-amber-800">{payload.risk_summary.summary}</p>
          </section>
        )}

        {share.settings.allow_client_comments && (
          <section className="mt-8 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-purple-700" />
              <h2 className="text-xl font-semibold">Client Comments</h2>
            </div>
            <div className="space-y-3">
              {comments.length === 0 ? (
                <p className="text-sm text-gray-500">No client comments yet.</p>
              ) : comments.map((comment) => (
                <div key={comment.id} className="rounded-2xl bg-gray-50 p-4">
                  <div className="text-sm font-medium">{comment.author_name}</div>
                  <p className="mt-1 text-sm leading-6 text-gray-600">{comment.content}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-[220px_1fr_auto]">
              <input value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="Your name" className="rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-purple-400" />
              <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Add a comment for the project team" className="rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-purple-400" />
              <button onClick={postComment} disabled={posting || !authorName.trim() || !commentText.trim()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">
                <Send className="h-4 w-4" />
                Send
              </button>
            </div>
            {commentError && <p className="mt-3 text-sm text-red-600">{commentError}</p>}
          </section>
        )}
      </main>
    </div>
  );
}
