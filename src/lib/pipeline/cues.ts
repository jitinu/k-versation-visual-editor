import type { Transcript, TranscriptWord } from "../types";

export type Cue =
  | { kind: "time"; image: string; start: number; end?: number; duration?: number; line: number }
  | { kind: "phrase"; image: string; phrase: string; endPhrase?: string; duration?: number; line: number };

export type ResolvedCue = { start: number; end: number; image: string; line: number };
type PendingCue = { start: number; end?: number; image: string; line: number };

const DURATION_RE = /^\d+(?:\.\d+)?s?$/i;

function normalizeWord(word: string): string {
  return word
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9']/g, "");
}

export function parseTimestamp(s: string): number {
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) throw new Error(`Invalid timestamp "${s}"`);
  const values = parts.map(Number);
  const seconds =
    values.length === 1
      ? values[0]
      : values.length === 2
        ? values[0] * 60 + values[1]
        : values[0] * 3600 + values[1] * 60 + values[2];
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`Invalid timestamp "${s}"`);
  return seconds;
}

function durationValue(s: string): number {
  if (!DURATION_RE.test(s)) throw new Error(`Invalid duration "${s}"`);
  const value = Number(s.replace(/s$/i, ""));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid duration "${s}"`);
  return value;
}

function normalizedQuote(char: string): string {
  return char === "“" ? "”" : char === "‘" ? "’" : char;
}

function readQuoted(line: string, offset: number): { value: string; next: number } | null {
  const open = line[offset];
  if (!open || !`"'“‘`.includes(open)) return null;
  const close = normalizedQuote(open);
  const end = line.indexOf(close, offset + 1);
  if (end < 0) return null;
  const value = line.slice(offset + 1, end).trim();
  if (!value) return null;
  return { value, next: end + 1 };
}

function parseImageAndDuration(rest: string, line: number): { image: string; duration?: number } {
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 2) throw new Error(`Line ${line}: expected an image and optional duration`);
  let duration: number | undefined;
  if (tokens.length === 2) {
    const durationToken = tokens[1];
    try {
      duration = durationValue(durationToken);
      tokens.pop();
    } catch {
      throw new Error(`Line ${line}: invalid duration "${durationToken}"`);
    }
  }
  const image = tokens[0];
  if (!image) throw new Error(`Line ${line}: image is required`);
  return { image, duration };
}

function parsePhrase(lineText: string, line: number): Cue {
  const first = readQuoted(lineText, 0);
  if (!first) throw new Error(`Line ${line}: expected a timestamp or quoted phrase`);
  let rest = lineText.slice(first.next).trim();
  let endPhrase: string | undefined;
  const separator = /^(?:\.\.|\-|to)(?:\s|$)/i.exec(rest);
  if (separator) {
    rest = rest.slice(separator[0].length).trim();
    const second = readQuoted(rest, 0);
    if (!second) throw new Error(`Line ${line}: expected a quoted ending phrase`);
    endPhrase = second.value;
    rest = rest.slice(second.next).trim();
  }
  const parsed = parseImageAndDuration(rest, line);
  return { kind: "phrase", image: parsed.image, phrase: first.value, endPhrase, duration: parsed.duration, line };
}

function parseTime(lineText: string, line: number): Cue {
  const tokens = lineText.trim().split(/\s+/).filter(Boolean);
  const first = tokens.shift();
  if (!first) throw new Error(`Line ${line}: cue is empty`);
  const dash = first.indexOf("-");
  let startText = first;
  let endText: string | undefined;
  if (dash >= 0) {
    startText = first.slice(0, dash);
    endText = first.slice(dash + 1);
    if (!startText || !endText) throw new Error(`Line ${line}: invalid time range`);
  }
  let start: number;
  try {
    start = parseTimestamp(startText);
  } catch {
    throw new Error(`Line ${line}: invalid timestamp "${startText}"`);
  }
  let end: number | undefined;
  if (endText && endText.toLowerCase() !== "end") {
    try {
      end = parseTimestamp(endText);
    } catch {
      throw new Error(`Line ${line}: invalid timestamp "${endText}"`);
    }
  }
  const parsed = parseImageAndDuration(tokens.join(" "), line);
  return { kind: "time", image: parsed.image, start, end, duration: parsed.duration, line };
}

export function parseCues(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = index + 1;
    const lineText = raw.trim();
    if (!lineText || lineText.startsWith("#")) continue;
    try {
      cues.push(/^\d/.test(lineText) ? parseTime(lineText, line) : parsePhrase(lineText, line));
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Line ")) throw err;
      throw new Error(`Line ${line}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return cues;
}

function imageKey(name: string): string {
  const base = name.split(/[\\/]/).pop()?.toLocaleLowerCase() ?? "";
  return base.replace(/\.[^.]+$/, "");
}

function resolveImage(ref: string, images: string[], line: number): string {
  const indexText = ref.startsWith("#") ? ref.slice(1) : ref;
  if (/^\d+$/.test(indexText)) {
    const index = Number(indexText);
    if (index >= 1 && index <= images.length) return images[index - 1];
  }
  const lower = ref.toLocaleLowerCase();
  const exact = images.find((name) => (name.split(/[\\/]/).pop()?.toLocaleLowerCase() ?? "") === lower);
  const withoutExtension = images.find((name) => imageKey(name) === imageKey(ref));
  if (exact ?? withoutExtension) return exact ?? withoutExtension!;
  throw new Error(`Line ${line}: unknown image "${ref}" (available: ${images.join(", ") || "none"})`);
}

function phraseTokens(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(prev[j] + 1, next[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = next;
  }
  return prev[b.length] <= Math.floor(Math.max(a.length, b.length) / 4);
}

function findPhrase(phrase: string, words: TranscriptWord[], after: number | undefined, line: number): { start: number; end: number; index: number } {
  const wanted = phraseTokens(phrase);
  if (!wanted.length) throw new Error(`Line ${line}: phrase "${phrase}" not found in narration`);
  const exact: Array<{ start: number; end: number; index: number }> = [];
  for (let i = 0; i <= words.length - wanted.length; i++) {
    if (after !== undefined && words[i].start <= after) continue;
    if (wanted.every((token, offset) => normalizeWord(words[i + offset].word) === token)) {
      exact.push({ start: words[i].start, end: words[i + wanted.length - 1].end, index: i });
    }
  }
  if (exact.length) return exact[0];

  let best: { score: number; start: number; end: number; index: number } | undefined;
  for (let i = 0; i <= words.length - wanted.length; i++) {
    if (after !== undefined && words[i].start <= after) continue;
    const score = wanted.reduce((sum, token, offset) => sum + (tokenMatch(token, normalizeWord(words[i + offset].word)) ? 1 : 0), 0);
    if (!best || score > best.score) best = { score, start: words[i].start, end: words[i + wanted.length - 1].end, index: i };
  }
  if (best && best.score / wanted.length >= 0.7) return best;
  throw new Error(`Line ${line}: phrase "${phrase}" not found in narration`);
}

export function resolveCues(cues: Cue[], images: string[], mediaDuration: number, transcript?: Transcript): ResolvedCue[] {
  if (cues.some((cue) => cue.kind === "phrase") && !transcript) throw new Error("Phrase cues require a transcript");
  const words = transcript?.words ?? [];
  let previousStart: number | undefined;
  const resolved = cues.map((cue) => {
    const image = resolveImage(cue.image, images, cue.line);
    let start: number;
    let end: number | undefined;
    if (cue.kind === "time") {
      start = cue.start;
      end = cue.end ?? (cue.duration === undefined ? undefined : cue.start + cue.duration);
    } else {
      const found = findPhrase(cue.phrase, words, previousStart, cue.line);
      start = found.start;
      end = cue.endPhrase
        ? findPhrase(cue.endPhrase, words, start, cue.line).end
        : cue.duration === undefined
          ? undefined
          : start + cue.duration;
    }
    previousStart = start;
    return { start, end, image, line: cue.line };
  });

  const sorted: PendingCue[] = resolved
    .map((cue) => ({
      ...cue,
      start: Math.max(0, Math.min(mediaDuration, cue.start)),
      end: cue.end === undefined ? undefined : Math.max(0, Math.min(mediaDuration, cue.end)),
    }))
    .sort((a, b) => a.start - b.start || a.line - b.line);
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].end === undefined) sorted[i].end = i + 1 < sorted.length ? sorted[i + 1].start : mediaDuration;
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i];
    const next = sorted[i + 1];
    if (current && next && current.end !== undefined && current.end > next.start) current.end = next.start;
  }
  return sorted.filter((cue): cue is ResolvedCue => cue.end !== undefined && cue.end > cue.start);
}
