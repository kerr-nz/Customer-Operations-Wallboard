// Resend mail utility — sends email through the Resend REST API.
// Requires the RESEND_API_KEY secret. Optionally set RESEND_FROM_EMAIL to a
// sender address on a domain verified in Resend; until then the default
// onboarding sender is used.

const DEFAULT_FROM = "onboarding@resend.dev";

export interface MailMessage {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export async function sendEmail(message: MailMessage): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "RESEND_API_KEY is not set. Password reset emails cannot be sent. Add the Resend API key provided by Spoke to your Secrets (key: RESEND_API_KEY)."
    );
  }

  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(message.to) ? message.to : [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(
      `Resend API error (${response.status}): ${(error as any).message || response.statusText}`
    );
  }

  return (await response.json()) as { id: string };
}
