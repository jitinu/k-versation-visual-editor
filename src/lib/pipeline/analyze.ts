import { z } from "zod";
import { config } from "../config";
import { chatJson } from "../llm/openai";
import { createLogger } from "../logger";
import type { CandidateMoment, Transcript, VisualFrequency, VisualType } from "../types";
import { clamp } from "../util";
import { analysisSystemPrompt, targetRange } from "./prompts";

const log = createLogger("analyze");

const momentSchema = z.object({
  start_time: z.number(),
  end_time: z.number(),
  transcript_excerpt: z.string(),
  visual_priority_score: z.number().min(0).max(1),
  why_visual_is_helpful: z.string(),
  search_query_1: z.string(),
  search_query_2: z.string().default(""),
  search_query_3: z.string().default(""),
  suggested_visual_type: z
    .enum(["photo", "map", "portrait", "document", "infographic", "other"])
    .catch("photo"),
});
const responseSchema = z.object({ moments: z.array(momentSchema) });

function formatTranscriptForLlm(t: Transcript): string {
  return t.segments.map((s) => `[${s.start.toFixed(1)}–${s.end.toFixed(1)}] ${s.text}`).join("\n");
}

/** Enforce the sparse-selection rules regardless of what the model returned. */
export function enforceSparsity(
  moments: CandidateMoment[],
  frequency: VisualFrequency,
  duration: number,
): CandidateMoment[] {
  const { max } = targetRange(frequency, duration);
  const cleaned = moments
    .map((m) => {
      const start = clamp(m.start_time, 0, Math.max(duration, m.start_time));
      let end = Math.max(m.end_time, start + 4);
      end = Math.min(end, start + 12);
      if (duration > 0) end = Math.min(end, duration);
      return { ...m, start_time: +start.toFixed(2), end_time: +end.toFixed(2) };
    })
    .filter((m) => m.end_time - m.start_time >= 2 && m.transcript_excerpt.trim().length > 0)
    .sort((a, b) => b.visual_priority_score - a.visual_priority_score);

  const picked: CandidateMoment[] = [];
  for (const m of cleaned) {
    if (picked.length >= max) break;
    const tooClose = picked.some((p) => Math.abs(p.start_time - m.start_time) < 8 || overlaps(p, m));
    if (tooClose) continue;
    picked.push(m);
  }
  return picked.sort((a, b) => a.start_time - b.start_time);
}

function overlaps(a: CandidateMoment, b: CandidateMoment): boolean {
  return a.start_time < b.end_time && b.start_time < a.end_time;
}

const MOCK_STOP = new Set(
  "The This That These Those When While After Before Because However Although Since Until Then There Here What Which Where Who Why How And But For Nor Yet Set In On At By To Of As".split(" "),
);

/**
 * MOCK analysis (no LLM): picks segments containing proper nouns / years and
 * spaces them out. Clearly weaker than the LLM path; used only when no key is set.
 */
export function mockAnalyze(transcript: Transcript, frequency: VisualFrequency): CandidateMoment[] {
  const scored = transcript.segments.map((s) => {
    const tokens = s.text.split(/\s+/);
    const proper = tokens.filter((t) => /^[A-Z][a-z]{2,}/.test(t) && !MOCK_STOP.has(t.replace(/[^A-Za-z]/g, "")));
    const years = tokens.filter((t) => /^\(?1[0-9]{3}\)?[.,]?$|^\(?20[0-9]{2}\)?[.,]?$/.test(t));
    const score = clamp(0.35 + proper.length * 0.12 + years.length * 0.15, 0, 0.98);
    const subject = [...proper.slice(0, 3), ...years.slice(0, 1)].join(" ").replace(/[^A-Za-z0-9 ]/g, "");
    const type: VisualType = /map|river|city|region|country|border/i.test(s.text)
      ? "map"
      : proper.length === 1 && /^[A-Z]/.test(proper[0])
        ? "portrait"
        : "photo";
    return {
      start_time: s.start,
      end_time: Math.min(s.end, s.start + 8),
      transcript_excerpt: s.text,
      visual_priority_score: proper.length + years.length > 0 ? score : 0.1,
      why_visual_is_helpful: proper.length
        ? `Mentions ${proper.slice(0, 2).join(" and ")} – a concrete visual referent. (mock analysis)`
        : "Low-value connector segment. (mock analysis)",
      search_query_1: subject || s.text.slice(0, 40),
      search_query_2: proper[0] ? `${proper[0]} historical photograph` : "",
      search_query_3: years[0] ? `${subject} ${years[0]}` : "",
      suggested_visual_type: type,
    } satisfies CandidateMoment;
  });
  return enforceSparsity(
    scored.filter((m) => m.visual_priority_score >= 0.45),
    frequency,
    transcript.duration,
  );
}

export async function analyzeMoments(transcript: Transcript, frequency: VisualFrequency): Promise<CandidateMoment[]> {
  if (config.llm.provider !== "openai") {
    log.info("using MOCK analysis (LLM_PROVIDER!=openai)");
    return mockAnalyze(transcript, frequency);
  }
  try {
    const raw = await chatJson<unknown>(
      [
        { role: "system", content: analysisSystemPrompt(frequency, transcript.duration) },
        { role: "user", content: `TIMESTAMPED TRANSCRIPT:\n${formatTranscriptForLlm(transcript)}` },
      ],
      { temperature: 0.2, maxTokens: 6000 },
    );
    const parsed = responseSchema.parse(raw);
    log.info(`LLM returned ${parsed.moments.length} candidate moments`);
    return enforceSparsity(parsed.moments, frequency, transcript.duration);
  } catch (err) {
    log.error("LLM analysis failed, falling back to mock analysis", err);
    return mockAnalyze(transcript, frequency);
  }
}
