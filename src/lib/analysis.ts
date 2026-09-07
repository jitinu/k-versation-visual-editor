import { config } from "@/lib/config";
import type {
  CandidateVisualMoment,
  TranscriptSegment,
  VisualFrequency,
  VisualType,
} from "@/lib/types";
import { clamp, retry } from "@/lib/utils";

interface AnalysisResponse {
  moments?: CandidateVisualMoment[];
}

const visualTerms =
  /\b(battle|war|map|city|country|president|king|queen|general|museum|archive|document|treaty|ship|aircraft|building|monument|river|mountain|island|company|organization|discovery|invention|protest|election|earthquake|portrait|photograph)\b/i;
const datePattern = /\b(?:1[5-9]\d{2}|20\d{2})\b/;
const properNounPattern = /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/;

export function targetVisualCount(
  duration: number,
  frequency: VisualFrequency,
): number {
  const minutes = duration / 60;
  const rate = frequency === "minimal" ? 1.1 : frequency === "balanced" ? 1.8 : 2.7;
  const minimum = frequency === "minimal" ? 3 : frequency === "balanced" ? 5 : 7;
  const maximum = frequency === "minimal" ? 10 : frequency === "balanced" ? 16 : 24;
  return Math.round(clamp(minutes * rate, minimum, maximum));
}

function transcriptForPrompt(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (segment) =>
        `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`,
    )
    .join("\n")
    .slice(0, 80_000);
}

function parseJsonContent(content: string): AnalysisResponse {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned) as AnalysisResponse;
}

async function analyzeWithOpenAi(
  transcript: TranscriptSegment[],
  target: number,
): Promise<CandidateVisualMoment[]> {
  if (!config.openAiApiKey) {
    return [];
  }
  const response = await fetch(`${config.openAiBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.analysisModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an exacting documentary visual editor. Select only moments where a specific, discoverable image materially improves understanding or emotional engagement. Prefer fewer strong visuals. Never force generic imagery. Return JSON only.",
        },
        {
          role: "user",
          content: `Select approximately ${target} sparse visual moments from this timestamped narration. Long gaps with no image are desirable. Return {"moments":[...]} with each object containing start_time, end_time, transcript_excerpt, visual_priority_score (0-100), why_visual_is_helpful, search_query_1, search_query_2, search_query_3, and suggested_visual_type (photo, map, portrait, document, infographic, or other). Keep each visual on screen for 4-10 seconds and within the narration duration.\n\n${transcriptForPrompt(transcript)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Transcript analysis failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Transcript analysis returned no content");
  }
  return parseJsonContent(content).moments ?? [];
}

function inferVisualType(text: string): VisualType {
  if (/\bmap|route|border|country|city|region\b/i.test(text)) return "map";
  if (/\bperson|president|king|queen|general|artist|author|portrait\b/i.test(text))
    return "portrait";
  if (/\bdocument|letter|treaty|constitution|newspaper\b/i.test(text))
    return "document";
  return "photo";
}

function keyPhrase(text: string): string {
  const properNoun = text.match(properNounPattern)?.[0];
  if (properNoun) return properNoun;
  const usefulWords = text
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 7);
  return usefulWords.join(" ");
}

export function heuristicAnalysis(
  transcript: TranscriptSegment[],
  target: number,
): CandidateVisualMoment[] {
  const scored = transcript.map((segment, index) => {
    const text = segment.text;
    let score = 20;
    if (visualTerms.test(text)) score += 32;
    if (datePattern.test(text)) score += 20;
    if (properNounPattern.test(text)) score += 24;
    if (index === 0 || index === transcript.length - 1) score += 5;
    if (text.length > 80) score += 6;
    return { segment, score: clamp(score, 0, 100) };
  });

  const selected: typeof scored = [];
  for (const candidate of scored.sort((a, b) => b.score - a.score)) {
    if (
      selected.every(
        ({ segment }) =>
          Math.abs(segment.start - candidate.segment.start) > 12,
      )
    ) {
      selected.push(candidate);
      if (selected.length === target) break;
    }
  }
  selected.sort((a, b) => a.segment.start - b.segment.start);

  return selected.map(({ segment, score }) => {
    const phrase = keyPhrase(segment.text) || "historical reference";
    const type = inferVisualType(segment.text);
    return {
      start_time: segment.start,
      end_time: Math.min(segment.end + 4, segment.start + 9),
      transcript_excerpt: segment.text,
      visual_priority_score: score,
      why_visual_is_helpful:
        score >= 65
          ? "A specific reference here can be grounded with authoritative imagery."
          : "This moment marks a useful topic shift without over-illustrating the narration.",
      search_query_1: phrase,
      search_query_2: `${phrase} ${type}`,
      search_query_3: `${phrase} Wikimedia Commons`,
      suggested_visual_type: type,
    };
  });
}

export async function analyzeTranscript(
  transcript: TranscriptSegment[],
  duration: number,
  frequency: VisualFrequency,
): Promise<CandidateVisualMoment[]> {
  const target = targetVisualCount(duration, frequency);
  if (config.openAiApiKey) {
    try {
      const moments = await retry(
        () => analyzeWithOpenAi(transcript, target),
        2,
        1000,
      );
      return moments
        .filter(
          (moment) =>
            Number.isFinite(moment.start_time) &&
            moment.start_time >= 0 &&
            moment.start_time < duration &&
            moment.visual_priority_score >= 45,
        )
        .slice(0, Math.max(target + 2, target));
    } catch (error) {
      console.error("LLM analysis unavailable; using local analysis.", error);
    }
  }
  return heuristicAnalysis(transcript, target);
}
