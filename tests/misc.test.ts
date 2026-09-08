import { describe, expect, it } from "vitest";
import { redact } from "@/lib/logger";
import { authorityFor } from "@/lib/pipeline/search";
import { transcriptToSrt } from "@/lib/pipeline/srt";
import { entryFromMoment, normalizeTimeline } from "@/lib/pipeline/timeline";
import { hammingHex } from "@/lib/pipeline/images";
import { mockTranscript } from "@/lib/pipeline/transcribe";
import { assertSafeSegment, resolveInProject } from "@/lib/storage/files";

describe("logger redaction", () => {
  it("masks secret-looking keys and values", () => {
    const out = redact({ apiKey: "abc", nested: { text: "token sk-1234567890abcdef ok" } }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect((out.nested as { text: string }).text).toContain("[redacted]");
  });
});

describe("srt", () => {
  it("formats timestamps", () => {
    const srt = transcriptToSrt(mockTranscript(10, "Hello world. This is a test sentence here now."));
    expect(srt).toMatch(/^1\n00:00:00,000 --> 00:00:\d\d,\d{3}\n/);
  });
});

describe("timeline", () => {
  it("enforces hold bounds and trims overlaps", () => {
    const a = entryFromMoment(
      { start_time: 10, end_time: 11, transcript_excerpt: "a", visual_priority_score: 1, why_visual_is_helpful: "", search_query_1: "", search_query_2: "", search_query_3: "", suggested_visual_type: "photo" },
      [], "x", 0.8,
    );
    expect(a.end - a.start).toBe(4);
    const b = { ...a, id: "b", start: 12, end: 18 };
    const [first] = normalizeTimeline([b, a]);
    expect(first.id).toBe(a.id);
    expect(first.end).toBeLessThan(12);
  });
});

describe("search authority", () => {
  it("ranks archives above stock sites", () => {
    expect(authorityFor("commons.wikimedia.org")).toBeGreaterThan(authorityFor("britannica.com"));
    expect(authorityFor("loc.gov")).toBeGreaterThan(authorityFor("shutterstock.com"));
  });
});

describe("hamming", () => {
  it("counts differing bits", () => {
    expect(hammingHex("0000000000000000", "000000000000000f")).toBe(4);
  });
});

describe("path safety", () => {
  it("rejects escapes", () => {
    expect(() => assertSafeSegment("../x")).toThrow();
    expect(() => resolveInProject("prj_abc", "../../etc/passwd")).toThrow();
    expect(resolveInProject("prj_abc", "images/a.jpg")).toMatch(/prj_abc[\\/]images[\\/]a\.jpg$/);
  });
});
