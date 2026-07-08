// Replit Mail utility — sends email through Replit's built-in mail service.
// Uses the repl/deployment identity token; no API key or user setup required.

export interface SmtpMessage {
  to: string | string[];
  cc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

function getAuthToken(): string {
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!xReplitToken) {
    throw new Error("No authentication token found. Replit Mail is only available inside Replit environments.");
  }

  return xReplitToken;
}

export async function sendEmail(message: SmtpMessage): Promise<{
  accepted: string[];
  rejected: string[];
  messageId: string;
  response: string;
}> {
  const authToken = getAuthToken();

  const response = await fetch("https://connectors.replit.com/api/v2/mailer/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      X_REPLIT_TOKEN: authToken,
    },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error((error as any).message || "Failed to send email");
  }

  return await response.json();
}
