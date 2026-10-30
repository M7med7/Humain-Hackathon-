import { createHash } from 'crypto';
import type { HumanRequest } from '../../models/run';

export interface ScheduledAnswer {
  afterHours: number;
  response: string;
}

/**
 * How requests reach people. The app leaves requests open for real users to answer;
 * the simulator answers them so a whole run can be evaluated unattended.
 */
export interface PeopleChannel {
  /** Called when a request opens or is reassigned. Null means no automatic answer. */
  deliver(request: HumanRequest, openedIndex: number): ScheduledAnswer | null;
}

export const manualPeople: PeopleChannel = { deliver: () => null };

const MIN_RESPONSE_HOURS = 1;
const RESPONSE_SPREAD_HOURS = 5;

/** Deterministic stand-ins for a client's team. */
export class SimulatedPeople implements PeopleChannel {
  /**
   * @param silentRequests indexes (in opening order) of requests whose first assignee never answers
   */
  constructor(private readonly silentRequests: ReadonlySet<number> = new Set()) {}

  deliver(request: HumanRequest, openedIndex: number): ScheduledAnswer | null {
    if (this.silentRequests.has(openedIndex) && !request.reassigned) return null;
    return { afterHours: responseDelay(request.id), response: answerFor(request) };
  }
}

/**
 * Demo mode: a simulated team handles task requests so the run keeps moving,
 * while decisions addressed to the client (deadline and scope trade-offs) wait
 * for the real user in the app.
 */
export class DemoTeam implements PeopleChannel {
  private readonly team = new SimulatedPeople();

  deliver(request: HumanRequest, openedIndex: number): ScheduledAnswer | null {
    return request.taskId === null ? null : this.team.deliver(request, openedIndex);
  }
}

function responseDelay(seed: string): number {
  const byte = createHash('sha256').update(seed).digest()[0] ?? 0;
  return MIN_RESPONSE_HOURS + (byte % (RESPONSE_SPREAD_HOURS * 2)) / 2;
}

function answerFor(request: HumanRequest): string {
  if (request.kind === 'approve') return request.options[0] ?? 'Approved';
  if (request.kind === 'provide') return `Provided: ${request.title}`;
  return 'Done';
}
