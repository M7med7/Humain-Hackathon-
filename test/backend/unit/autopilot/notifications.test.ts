import type { HumanRequest, Run, RunEvent } from '../../../../backend/src/autopilot/models/run';
import { ResendEmailSender, type Email } from '../../../../backend/src/autopilot/services/notifications/emailSender';
import { RunNotifier } from '../../../../backend/src/autopilot/services/notifications/runNotifier';

const request = (id: string, assignee: string, taskId: string | null = 't1', status: HumanRequest['status'] = 'open'): HumanRequest => ({
  id, taskId, kind: 'approve', assignee, title: 'Approve the <b>budget</b>', prompt: 'Review and approve.', options: ['Approve', 'Decline'],
  openedAtHour: 0, status, response: null, reminders: 0, reassigned: false, effortHours: 0,
});

const completed = (seq: number): RunEvent => ({ seq, hour: 8, actor: 'lead', kind: 'acted', type: 'completed', summary: 'Delivered', taskId: null });

const run = (patch: Partial<Run>): Run => ({
  id: 'run-1', startedAt: '', title: 'Ramadan launch', objective: 'Launch', deadlineDays: 5, lang: 'en', summary: 'Plan', status: 'running',
  tasks: [], requests: [], deliverables: [], events: [], calls: [], report: null, stopReason: null, ...patch,
});

function setup(email: string | null = 'owner@example.com') {
  const sent: Email[] = [];
  const notifier = new RunNotifier({ send: async (item) => void sent.push(item) }, async () => email, 'https://app.example.com/');
  return { sent, notifier };
}

describe('RunNotifier', () => {
  const owner = new Set(['Mohammed']);

  it('emails the owner once per request waiting on them or a client decision, never for teammates', async () => {
    const { sent, notifier } = setup();
    const waiting = run({ requests: [request('r1', 'Mohammed'), request('r2', 'Sara'), request('r3', 'Sara', null), request('r4', 'Mohammed', 't2', 'answered')] });
    await notifier.notify(waiting, 'user-1', owner);
    await notifier.notify(waiting, 'user-1', owner);

    expect(sent.map((item) => item.subject)).toEqual(['Autopilot needs you: Approve the <b>budget</b>', 'Autopilot needs you: Approve the <b>budget</b>']);
    expect(sent[0]?.to).toBe('owner@example.com');
    expect(sent[0]?.html).toContain('Approve the &#60;b&#62;budget&#60;/b&#62;');
    expect(sent[0]?.text).toContain('https://app.example.com/autopilot/run-1');
  });

  it('emails each delivery, including after a change reopens the run', async () => {
    const { sent, notifier } = setup();
    await notifier.notify(run({ status: 'completed', events: [completed(4)], report: { en: 'All done on day 3.', ar: 'تم' } }), 'user-1', owner);
    await notifier.notify(run({ status: 'completed', events: [completed(4)] }), 'user-1', owner);
    await notifier.notify(run({ status: 'completed', events: [completed(4), completed(9)] }), 'user-1', owner);

    expect(sent.map((item) => item.subject)).toEqual(['Delivered: Ramadan launch', 'Delivered: Ramadan launch']);
    expect(sent[0]?.text).toContain('All done on day 3.');
  });

  it('does not repeat what a reopened run already showed, and skips owners without an email', async () => {
    const { sent, notifier } = setup();
    const waiting = run({ requests: [request('r1', 'Mohammed')] });
    notifier.prime(waiting, owner);
    await notifier.notify(waiting, 'user-1', owner);
    expect(sent).toHaveLength(0);

    const silent = setup(null);
    await silent.notifier.notify(waiting, 'user-1', owner);
    expect(silent.sent).toHaveLength(0);
  });
});

describe('ResendEmailSender', () => {
  const email: Email = { to: 'owner@example.com', subject: 'Hi', text: 'Hello', html: '<p>Hello</p>' };

  it('posts the email to Resend with the key as a bearer token', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const post = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await new ResendEmailSender('re_test_key', 'Autopilot <onboarding@resend.dev>', post).send(email);

    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key');
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ from: 'Autopilot <onboarding@resend.dev>', to: ['owner@example.com'], subject: 'Hi' });
  });

  it("reports Resend's reason without the key when it rejects an email", async () => {
    const post = (async () => new Response(JSON.stringify({ message: 'You can only send testing emails to your own address' }), { status: 403 })) as unknown as typeof fetch;
    const sending = new ResendEmailSender('re_secret_key', 'from@example.com', post).send(email);
    await expect(sending).rejects.toThrow('Resend rejected the email (403): You can only send testing emails to your own address');
    await expect(sending).rejects.not.toThrow('re_secret_key');
  });
});
