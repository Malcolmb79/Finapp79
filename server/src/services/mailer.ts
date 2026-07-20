import { Resend } from "resend";

/**
 * Transactional email (password reset, email verification). Same "missing
 * config degrades gracefully" principle as Enable Banking/OAuth: without
 * RESEND_API_KEY, this logs the email to the console instead of throwing —
 * lets local dev exercise the full reset/verify flow (grab the link from
 * the server log) without needing a real Resend account.
 */
let client: Resend | null | undefined;

function getClient(): Resend | null {
  if (client !== undefined) return client;
  client = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  return client;
}

export async function sendEmail(opts: { to: string; subject: string; html: string; text: string }): Promise<void> {
  const resend = getClient();
  const from = process.env.EMAIL_FROM ?? "Personal Finance <onboarding@resend.dev>";

  if (!resend) {
    console.warn(
      `[mailer] RESEND_API_KEY not set — email not actually sent.\n` +
        `  To: ${opts.to}\n  Subject: ${opts.subject}\n  ${opts.text}`
    );
    return;
  }

  const { error } = await resend.emails.send({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
  if (error) throw new Error(`Failed to send email via Resend: ${error.message}`);
}
