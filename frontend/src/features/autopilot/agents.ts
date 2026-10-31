import type { AgentRole, Run, RunEvent, RunTask } from './types';

/** What one agent is doing right now, derived from the streamed run. */
export type AgentState = 'active' | 'sleeping' | 'done';

export interface AgentCard {
  /** Activity actor key: planner, router, reviewer, lead or agent:<role>. */
  actor: string;
  state: AgentState;
  /** What it is busy with when active: planning, routing, working, reviewing or reporting. */
  activity: 'planning' | 'replanning' | 'routing' | 'working' | 'reviewing' | 'reporting' | null;
  /** Task titles it is on right now. */
  tasks: string[];
  attempt: number | null;
  /** Its most recent line in the activity log. */
  lastAction: string | null;
  /** Deliverables approved for this agent (workers) or by it (reviewer). */
  finished: number;
}

const WORKER_ORDER: AgentRole[] = ['researcher', 'writer', 'analyst', 'builder'];
const LIVE = new Set<Run['status']>(['planning', 'running', 'waiting_on_people']);

const lastOf = (events: readonly RunEvent[], predicate: (event: RunEvent) => boolean): RunEvent | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && predicate(event)) return event;
  }
  return undefined;
};

const roleOf = (task: RunTask): AgentRole => task.routing.role ?? 'writer';

/** One card per agent in the run, in pipeline order. */
export function agentActivity(run: Run): AgentCard[] {
  const live = LIVE.has(run.status);
  const events = run.events;
  const lastAction = (actor: string): string | null => lastOf(events, (event) => event.actor === actor)?.summary ?? null;
  const settled = (busy: boolean): AgentState => (busy ? 'active' : live ? 'sleeping' : 'done');

  const planned = events.some((event) => event.type === 'planned');
  const lastMessage = lastOf(events, (event) => event.type === 'client_message');
  const replanning = Boolean(lastMessage) && !events.some((event) => event.seq > (lastMessage?.seq ?? 0) && (event.type === 'scope_added' || event.type === 'scope_unchanged'));
  const planning = run.status === 'planning' && !planned;
  const routing = run.status === 'planning' && planned;

  const cards: AgentCard[] = [
    { actor: 'planner', state: settled(planning || (live && replanning)), activity: planning ? 'planning' : live && replanning ? 'replanning' : null, tasks: [], attempt: null, lastAction: lastAction('planner'), finished: 0 },
    { actor: 'router', state: settled(routing), activity: routing ? 'routing' : null, tasks: [], attempt: null, lastAction: lastAction('router'), finished: 0 },
  ];

  const agentTasks = run.tasks.filter((task) => task.routing.executor !== 'human');
  const approved = new Set(events.filter((event) => event.type === 'approved' && event.taskId).map((event) => event.taskId));
  for (const role of WORKER_ORDER) {
    const mine = agentTasks.filter((task) => roleOf(task) === role);
    if (mine.length === 0) continue;
    const working = mine.filter((task) => task.status === 'working');
    const pending = mine.some((task) => task.status === 'waiting');
    cards.push({
      actor: `agent:${role}`,
      state: working.length > 0 ? 'active' : live && pending ? 'sleeping' : 'done',
      activity: working.length > 0 ? 'working' : null,
      tasks: working.map((task) => task.title),
      attempt: working.length === 1 ? (working[0]?.attempts ?? null) : null,
      lastAction: lastAction(`agent:${role}`),
      finished: mine.filter((task) => approved.has(task.id)).length,
    });
  }

  const inReview = run.tasks.filter((task) => task.status === 'review');
  cards.push({
    actor: 'reviewer',
    state: settled(inReview.length > 0),
    activity: inReview.length > 0 ? 'reviewing' : null,
    tasks: inReview.map((task) => task.title),
    attempt: null,
    lastAction: lastAction('reviewer'),
    finished: events.filter((event) => event.type === 'approved').length,
  });

  const reporting = live && lastOf(events, (event) => event.actor === 'lead')?.type === 'reporting';
  cards.push({ actor: 'lead', state: settled(reporting), activity: reporting ? 'reporting' : null, tasks: [], attempt: null, lastAction: lastAction('lead'), finished: 0 });

  return cards;
}
