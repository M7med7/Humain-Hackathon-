/** Things that wake the engine. Nothing runs between events: idle agents cost nothing. */
export type EngineEvent =
  | { type: 'ready'; taskId: string }
  | { type: 'complete'; taskId: string }
  | { type: 'answer'; requestId: string; response: string; by: string }
  | { type: 'timeout'; requestId: string }
  | { type: 'client_message'; message: string };

interface Scheduled {
  hour: number;
  seq: number;
  event: EngineEvent;
}

/** Time-ordered queue on the simulated clock; events at the same hour keep insertion order. */
export class EventQueue {
  private items: Scheduled[] = [];
  private seq = 0;

  push(hour: number, event: EngineEvent): void {
    this.items.push({ hour, seq: this.seq++, event });
    this.items.sort((a, b) => a.hour - b.hour || a.seq - b.seq);
  }

  get size(): number {
    return this.items.length;
  }

  /** Removes and returns every event due at the earliest hour. */
  popEarliest(): { hour: number; events: EngineEvent[] } | null {
    const first = this.items[0];
    if (!first) return null;
    const due = this.items.filter((item) => item.hour === first.hour);
    this.items = this.items.slice(due.length);
    return { hour: first.hour, events: due.map((item) => item.event) };
  }
}
