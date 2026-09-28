import examples from "./examples.json";
import type { VisualFrequency } from "../types";

/**
 * Calibrated against 13 published K-VERSATION videos (see reference-ingest.ts for the numbers):
 * the channel averages ~3 image changes per minute, visuals are on screen only ~20–50% of the
 * runtime (the rest is black), and the median hold is ~5 s. "Balanced" reproduces that density;
 * "Minimal" is the deliberately sparser 4–10-per-video default; "Frequent" matches the densest
 * sports/news episodes (~4–5 per minute).
 */
export const FREQUENCY_TARGETS: Record<
  VisualFrequency,
  { perMinuteMin: number; perMinuteMax: number; absMin: number; absMax: number; minGapSeconds: number; label: string }
> = {
  minimal: { perMinuteMin: 1.0, perMinuteMax: 1.6, absMin: 4, absMax: 10, minGapSeconds: 8, label: "Minimal (default)" },
  balanced: { perMinuteMin: 2.0, perMinuteMax: 3.0, absMin: 6, absMax: 24, minGapSeconds: 5, label: "Balanced (channel average)" },
  frequent: { perMinuteMin: 3.0, perMinuteMax: 4.5, absMin: 8, absMax: 36, minGapSeconds: 3, label: "Frequent" },
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

EDITORIAL STYLE (K-VERSATION – learned from the channel's published episodes):
- The screen is BLACK by default. In a typical episode visuals are on screen only 20–50% of the time; the rest is the narrator's voice over black. Silence in visuals is a feature.
- A visual appears only when it adds information the words cannot: a face, a place, a building, an object, a document, a map, a logo, a chart, a table.
- Visuals cluster around the INTRODUCTION of a concrete subject: when a new person, place, institution, product, event or artefact is named, show it (sometimes 2–3 closely related images back-to-back: statue → palace → manuscript), then return to black while the narrator elaborates, reflects or transitions.
- Strong candidates: FIRST mention of a named person (portrait / press photo / action shot), named places and buildings, geographic context (map), quoted documents, treaties, manuscripts, scripts and letters, statistics and comparisons (chart, table, infographic), organisation/brand logos at first mention, major events (summits, battles, matches, disasters, founding moments) with the single most iconic photo, and emotional beats with a period photograph.
- Never select: verbal connectors ("so", "now", "as I said"), narrator asides and opinions, rhetorical questions, abstract reflection, definitions with no concrete referent, repeated mentions of something already shown, or generic statements ("people were happy").
- Each image is shown as-is at its native aspect ratio on black (letterboxed) – prefer clean, legible, high-resolution images that read well when centred on black. No crops, no montages, no Ken Burns.
- Each moment is a contiguous span from the transcript, 4–10 seconds long (extend to 12 s max only for a long quoted document). Adjacent moments must be at least ${FREQUENCY_TARGETS[frequency].minGapSeconds} seconds apart.
- Prefer specific, searchable subjects over generic ones ("Gyeongbokgung Palace Geunjeongjeon", not "Korean palace"; "Son Heung-min Tottenham 2023", not "football player").

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
