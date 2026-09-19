import type { TimelineEntry, Transcript } from "../types";

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

export function transcriptToSrt(t: Transcript): string {
  return t.segments
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text.trim()}\n`)
    .join("\n");
}

export function transcriptToText(t: Transcript): string {
  return t.segments.map((s) => `[${srtTime(s.start).slice(0, 8)}] ${s.text.trim()}`).join("\n");
}

export function timelineToJson(entries: TimelineEntry[]): string {
  const clean = entries
    .filter((e) => !e.removed)
    .map((e) => {
      const chosen = e.candidates.find((c) => c.id === e.chosenCandidateId);
      return {
        id: e.id,
        start: e.start,
        end: e.end,
        duration: +(e.end - e.start).toFixed(2),
        excerpt: e.excerpt,
        reason: e.reason,
        visualType: e.visualType,
        priority: e.priority,
        confidence: e.confidence,
        status: e.status,
        chosen: chosen
          ? {
              title: chosen.title,
              imageUrl: chosen.imageUrl,
              sourcePageUrl: chosen.sourcePageUrl,
              sourceName: chosen.sourceName,
              attribution: chosen.attribution,
              license: chosen.license,
              localPath: chosen.localPath,
            }
          : null,
        alternatives: e.candidates
          .filter((c) => c.id !== e.chosenCandidateId && !c.rejected)
          .map((c) => ({ title: c.title, imageUrl: c.imageUrl, sourcePageUrl: c.sourcePageUrl })),
      };
    });
  return JSON.stringify(clean, null, 2);
}
