import { config } from "../config";
import { chatJson } from "../llm/openai";
import { createLogger } from "../logger";
import type { Transcript } from "../types";
import { titleSystemPrompt } from "./prompts";

const log = createLogger("title");

const STOP = new Set(
  "the a an and or but of in on at to for with from by as is was were be been are this that these those it its into over under about after before during through i you we they he she his her their our your not no so then than very just also more most some any".split(
    " ",
  ),
);

/** Heuristic title used in mock mode or as fallback: most frequent capitalised/rare words. */
export function heuristicTitle(text: string): string {
  const counts = new Map<string, number>();
  for (const raw of text.split(/\s+/)) {
    const w = raw.replace(/[^A-Za-z0-9'-]/g, "");
    if (w.length < 4 || STOP.has(w.toLowerCase())) continue;
    const key = w[0] === w[0].toUpperCase() ? w : w.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + (w[0] === w[0].toUpperCase() ? 2 : 1));
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([w]) => w[0].toUpperCase() + w.slice(1));
  return top.length ? top.join(" & ").replace(/ & ([^&]*)$/, " and $1") : "Untitled Narration";
}

export async function generateTitle(transcript: Transcript): Promise<{ title: string; alternates: string[] }> {
  const excerpt = transcript.text.slice(0, 12000);
  if (config.llm.provider === "mock") {
    return { title: heuristicTitle(excerpt), alternates: [] };
  }
  try {
    const res = await chatJson<{ title?: string; alternates?: string[] }>(
      [
        { role: "system", content: titleSystemPrompt() },
        { role: "user", content: `TRANSCRIPT:\n${excerpt}` },
      ],
      { temperature: 0.6, maxTokens: 200 },
    );
    const title = res.title?.trim();
    if (!title) throw new Error("empty title");
    return { title, alternates: res.alternates ?? [] };
  } catch (err) {
    log.warn("LLM title failed, using heuristic", err);
    return { title: heuristicTitle(excerpt), alternates: [] };
  }
}
