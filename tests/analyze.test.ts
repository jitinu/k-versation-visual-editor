import { describe, expect, it } from "vitest";
import { enforceSparsity, mockAnalyze } from "@/lib/pipeline/analyze";
import { targetRange } from "@/lib/pipeline/prompts";
import { mockTranscript } from "@/lib/pipeline/transcribe";
import type { CandidateMoment } from "@/lib/types";

const moment = (start: number, score: number): CandidateMoment => ({
  start_time: start,
  end_time: start + 6,
  transcript_excerpt: `excerpt ${start}`,
  visual_priority_score: score,
  why_visual_is_helpful: "test",
  search_query_1: "q",
  search_query_2: "",
  search_query_3: "",
  suggested_visual_type: "photo",
});

describe("targetRange", () => {
  it("defaults to 4–10 moments for a 3–8 minute narration on minimal", () => {
    expect(targetRange("minimal", 180)).toEqual({ min: 4, max: 5 });
    expect(targetRange("minimal", 480)).toEqual({ min: 8, max: 10 });
    expect(targetRange("frequent", 300).max).toBeGreaterThan(targetRange("minimal", 300).max);
  });
});

describe("enforceSparsity", () => {
  it("drops moments closer than 8s, preferring higher priority", () => {
    const out = enforceSparsity([moment(0, 0.5), moment(4, 0.9), moment(30, 0.7)], "minimal", 300);
    expect(out.map((m) => m.start_time)).toEqual([4, 30]);
  });

  it("caps to the frequency maximum and clamps hold length", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...moment(i * 10, 0.8), end_time: i * 10 + 30 }));
    const out = enforceSparsity(many, "minimal", 300);
    expect(out.length).toBeLessThanOrEqual(targetRange("minimal", 300).max);
    for (const m of out) expect(m.end_time - m.start_time).toBeLessThanOrEqual(12);
  });
});

describe("mockAnalyze", () => {
  it("prefers segments with proper nouns and skips connectors", () => {
    const t = mockTranscript(120);
    const out = mockAnalyze(t, "minimal");
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((m) => /Napoleon|Wellington|Waterloo/.test(m.transcript_excerpt))).toBe(true);
  });
});
