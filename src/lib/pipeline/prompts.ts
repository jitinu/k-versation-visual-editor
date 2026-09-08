import examples from "./examples.json";
import type { VisualFrequency } from "../types";

export const FREQUENCY_TARGETS: Record<
  VisualFrequency,
  { perMinuteMin: number; perMinuteMax: number; absMin: number; absMax: number; label: string }
> = {
  minimal: { perMinuteMin: 1.0, perMinuteMax: 1.6, absMin: 4, absMax: 10, label: "Minimal (default)" },
  balanced: { perMinuteMin: 1.6, perMinuteMax: 2.6, absMin: 6, absMax: 16, label: "Balanced" },
  frequent: { perMinuteMin: 2.6, perMinuteMax: 4.0, absMin: 8, absMax: 26, label: "Frequent" },
};

export function targetRange(frequency: VisualFrequency, durationSeconds: number) {
  const t = FREQUENCY_TARGETS[frequency];
  const minutes = Math.max(durationSeconds / 60, 0.5);
  const min = Math.max(1, Math.min(t.absMax, Math.max(t.absMin, Math.round(minutes * t.perMinuteMin))));
  const max = Math.max(min, Math.min(t.absMax, Math.round(minutes * t.perMinuteMax)));
  return { min, max };
}

export function analysisSystemPrompt(frequency: VisualFrequency, durationSeconds: number): string {
  const { min, max } = targetRange(frequency, durationSeconds);
  return `You are the visual editor for K-VERSATION, a narration-driven documentary channel.
Your job: read a timestamped narration transcript and choose a SPARSE, INTENTIONAL set of moments where a single still image would genuinely help the viewer.

EDITORIAL STYLE (K-VERSATION):
- A visual appears only when it adds information the words cannot: a face, a place, a document, a map, a scale, an object.
- Most of the narration should stay on a plain background. Silence in visuals is a feature.
- Strong candidates: major events (battles, disasters, founding moments), FIRST mention of a named person, named places and geographic movement (maps), quoted documents/treaties/letters, statistics (infographic), emotional beats with a well-known period photograph, and clear topic transitions.
- Never select: verbal connectors ("so", "now", "as I said"), narrator asides, rhetorical questions, abstract reflection, repeated mentions of something already shown, or generic statements with no concrete visual referent.
- One strong image per beat. Do not create montages. Adjacent moments must be at least 8 seconds apart.
- Each moment must be a contiguous span from the transcript, 4–10 seconds long (extend to 12s max only for a long quoted document).
- Prefer specific, searchable subjects over generic ones ("Battle of Waterloo painting", not "war scene").

QUANTITY: the narration is ${Math.round(durationSeconds)} seconds long and the requested frequency is "${frequency}". Return between ${min} and ${max} moments, biased toward the LOWER end. If fewer moments truly deserve a visual, return fewer – never pad.

SEARCH QUERIES: for each moment give 3 distinct queries suitable for Wikimedia Commons / image search, most specific first. Include names, years, places; avoid stop words.

OUTPUT: strict JSON object {"moments": Moment[]} where Moment =
{
  "start_time": number (seconds, from transcript timestamps),
  "end_time": number,
  "transcript_excerpt": string (verbatim words from the transcript in this span),
  "visual_priority_score": number 0..1 (how much the visual helps; >0.8 = essential),
  "why_visual_is_helpful": string (one sentence),
  "search_query_1": string,
  "search_query_2": string,
  "search_query_3": string,
  "suggested_visual_type": "photo" | "map" | "portrait" | "document" | "infographic" | "other"
}
Sort by start_time. Output JSON only.

FEW-SHOT EXAMPLES OF THE HOUSE STYLE (selected vs skipped):
${JSON.stringify(examples.examples, null, 1)}`;
}

export function titleSystemPrompt(): string {
  return `You write titles for K-VERSATION, a documentary narration channel. Given a transcript, produce the best possible project title: specific, evocative, 3–9 words, Title Case, no quotes, no clickbait, no trailing punctuation. Also produce up to 3 alternates. Respond as JSON: {"title": string, "alternates": string[]}.`;
}

export function visionRankSystemPrompt(): string {
  return `You are a picture editor evaluating candidate images for a documentary narration moment.
For each image judge: relevance (does it depict the specific subject?), specificity (the exact person/place/event rather than something generic), clarity (legible, not a tiny thumbnail, not a screenshot/meme/logo), and fit (works as a full-frame 16:9 still for several seconds).
Penalise watermarks, heavy text overlays, collages, low resolution, and images that depict the WRONG person/event even if visually appealing.
Respond as JSON: {"results": [{"index": number, "score": number 0..1, "reason": string, "acceptable": boolean}]}. Mark acceptable=false if you would not confidently show it; it is better to show nothing than a wrong image.`;
}
