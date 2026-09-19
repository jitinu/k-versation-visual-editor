import { randomBytes } from "node:crypto";

export function newId(prefix = ""): string {
  const id = randomBytes(6).toString("base64url");
  return prefix ? `${prefix}_${id}` : id;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { retries: number; baseDelayMs?: number; onRetry?: (err: unknown, attempt: number) => void },
): Promise<T> {
  const base = opts.baseDelayMs ?? 400;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === opts.retries) break;
      opts.onRetry?.(err, attempt + 1);
      await sleep(base * 2 ** attempt + Math.random() * 100);
    }
  }
  throw lastErr;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9']/g, "");
}

export function tokenizeWords(text: string): string[] {
  return text.split(/\s+/).filter((t) => normalizeWord(t).length > 0);
}
