// Shared display formatters used across all wallboard views so every
// dashboard renders durations and times identically.

// Formats a duration in whole seconds, e.g. 75 -> "1m 15s", 30 -> "30s".
export function formatSeconds(s: number): string {
  if (!s || s <= 0) return "0s";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// Formats an ISO timestamp as a local HH:MM time, e.g. "14:05".
export function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}
