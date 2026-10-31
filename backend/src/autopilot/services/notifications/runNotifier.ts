import type { HumanRequest, Run } from '../../models/run';
import type { Email, EmailSender } from './emailSender';

/** Finds the address of a ZeroOne user, or null when there is none. */
export type EmailLookup = (userId: string) => Promise<string | null>;

const MAX_SUBJECT = 120;
const MAX_REPORT_EXCERPT = 700;

/**
 * Emails the person who started a run: once for each request waiting on them (or a client
 * decision), and once each time the run is delivered. Everything else stays in the app.
 */
export class RunNotifier {
  private readonly sent = new Map<string, Set<string>>();

  constructor(
    private readonly sender: EmailSender,
    private readonly lookupEmail: EmailLookup,
    private readonly appUrl: string,
  ) {}

  /** Marks what a reopened run already shows, so picking it back up does not repeat emails. */
  prime(run: Run, ownerNames: ReadonlySet<string>): void {
    const keys = this.sentFor(run.id);
    for (const { key } of this.due(run, ownerNames)) keys.add(key);
  }

  async notify(run: Run, ownerId: string, ownerNames: ReadonlySet<string>): Promise<void> {
    const keys = this.sentFor(run.id);
    const fresh = this.due(run, ownerNames).filter(({ key }) => !keys.has(key));
    if (fresh.length === 0) return;
    for (const { key } of fresh) keys.add(key);
    const to = await this.lookupEmail(ownerId);
    if (!to) return;
    for (const { email } of fresh) await this.sender.send({ ...email(this.link(run)), to });
  }

  private due(run: Run, ownerNames: ReadonlySet<string>): Array<{ key: string; email: (link: string) => Omit<Email, 'to'> }> {
    const waiting = run.requests
      .filter((request) => request.status === 'open' && (request.taskId === null || ownerNames.has(request.assignee)))
      .map((request) => ({ key: `request:${request.id}`, email: (link: string) => requestEmail(run, request, link) }));
    const delivered = [...run.events].reverse().find((event) => event.type === 'completed');
    const done = run.status === 'completed' && delivered ? [{ key: `completed:${delivered.seq}`, email: (link: string) => deliveredEmail(run, link) }] : [];
    return [...waiting, ...done];
  }

  private sentFor(runId: string): Set<string> {
    const existing = this.sent.get(runId);
    if (existing) return existing;
    const created = new Set<string>();
    this.sent.set(runId, created);
    return created;
  }

  private link(run: Run): string {
    return `${this.appUrl.replace(/\/$/, '')}/autopilot/${run.id}`;
  }
}

function requestEmail(run: Run, request: HumanRequest, link: string): Omit<Email, 'to'> {
  const project = run.title || run.objective;
  const lines = [`${project} needs you.`, '', request.title, request.prompt, request.options.length > 0 ? `Options: ${request.options.join(' / ')}` : ''];
  return {
    subject: subject(`Autopilot needs you: ${request.title}`),
    text: [...lines, '', `Open the run: ${link}`].join('\n'),
    html: layout(`<p>${escape(project)} needs you.</p><p><strong>${escape(request.title)}</strong><br>${escape(request.prompt)}</p>`, link, 'Open the run'),
  };
}

function deliveredEmail(run: Run, link: string): Omit<Email, 'to'> {
  const project = run.title || run.objective;
  const report = (run.report?.[run.lang] ?? run.summary).slice(0, MAX_REPORT_EXCERPT);
  return {
    subject: subject(`Delivered: ${project}`),
    text: [`${project} is delivered.`, '', report, '', `Read the report: ${link}`].join('\n'),
    html: layout(`<p><strong>${escape(project)}</strong> is delivered.</p><p dir="auto" style="white-space:pre-line">${escape(report)}</p>`, link, 'Read the report'),
  };
}

function layout(body: string, link: string, action: string): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${body}<p><a href="${escape(link)}" style="display:inline-block;background:#2997ff;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">${action}</a></p><p style="color:#666;font-size:12px">Sent by ZeroOne Autopilot</p></div>`;
}

/** Subjects are one line; model-written titles must not inject headers or run long. */
function subject(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT);
}

/** Titles and reports come from people and models, so they are escaped before going into HTML. */
function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
