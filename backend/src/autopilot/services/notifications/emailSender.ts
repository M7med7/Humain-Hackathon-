export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  send(email: Email): Promise<void>;
}

const RESEND_URL = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

/** Sends through Resend's HTTP API. Errors carry Resend's message, never the key. */
export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly post: typeof fetch = fetch,
  ) {}

  async send(email: Email): Promise<void> {
    const response = await this.post(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (response.ok) return;
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(`Resend rejected the email (${response.status}): ${body.message ?? 'no details'}`);
  }
}
