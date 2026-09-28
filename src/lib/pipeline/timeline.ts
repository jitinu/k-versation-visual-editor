import type { CandidateMoment, ImageCandidate, TimelineEntry } from "../types";
import { newId } from "../util";

export const MIN_HOLD = 4;
export const MAX_HOLD = 10;

export function entryFromMoment(
  moment: CandidateMoment,
  candidates: ImageCandidate[],
  chosenId: string | null,
  confidence: number,
  duration?: number,
): TimelineEntry {
  let start = Math.max(0, moment.start_time);
  let end = Math.max(moment.end_time, start + MIN_HOLD);
  end = Math.min(end, start + MAX_HOLD);
  if (duration && end > duration) {
    end = duration;
    start = Math.max(0, Math.min(start, end - MIN_HOLD));
  }
  return {
    id: newId("tl"),
    start: +start.toFixed(2),
    end: +end.toFixed(2),
    excerpt: moment.transcript_excerpt,
    reason: moment.why_visual_is_helpful,
    visualType: moment.suggested_visual_type,
    priority: moment.visual_priority_score,
    confidence,
    status: chosenId ? "ok" : "skipped",
    searchQueries: [moment.search_query_1, moment.search_query_2, moment.search_query_3].filter(Boolean),
    chosenCandidateId: chosenId,
    candidates,
  };
}

/** Resolve overlaps by trimming the earlier entry; gaps are allowed. */
export function normalizeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.removed || b.removed) continue;
    if (a.end > b.start) a.end = Math.max(a.start + 1, +(b.start - 0.1).toFixed(2));
  }
  return sorted;
}

export function chosenImage(entry: TimelineEntry): ImageCandidate | undefined {
  if (!entry.chosenCandidateId) return undefined;
  return entry.candidates.find((c) => c.id === entry.chosenCandidateId);
}

export function activeEntries(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.filter((e) => !e.removed && e.chosenCandidateId && chosenImage(e)?.localPath);
}
