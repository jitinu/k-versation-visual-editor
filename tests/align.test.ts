import { describe, expect, it } from "vitest";
import { alignScriptToTranscript } from "@/lib/pipeline/align";
import { mockTranscript, segmentWords } from "@/lib/pipeline/transcribe";
import type { Transcript } from "@/lib/types";

function asr(words: Array<[string, number]>): Transcript {
  const ws = words.map(([word, start]) => ({ word, start, end: start + 0.4 }));
  return { text: ws.map((w) => w.word).join(" "), duration: ws.at(-1)!.end, words: ws, segments: segmentWords(ws), provider: "test" };
}

describe("alignScriptToTranscript", () => {
  it("keeps script wording but takes timestamps from the audio", () => {
    const transcript = asr([
      ["in", 0],
      ["eighteen", 0.5],
      ["fifteen", 1],
      ["napoleon", 1.5],
      ["escaped", 2],
      ["from", 2.5],
      ["elba", 3],
    ]);
    const aligned = alignScriptToTranscript("In 1815, Napoleon escaped from Elba.", transcript);
    expect(aligned.alignedFromScript).toBe(true);
    expect(aligned.words.map((w) => w.word)).toEqual(["In", "1815,", "Napoleon", "escaped", "from", "Elba."]);
    expect(aligned.words[0].start).toBe(0);
    expect(aligned.words[2].start).toBe(1.5); // "Napoleon" anchored to ASR word
    expect(aligned.words[5].start).toBe(3);
    // "1815," unmatched → interpolated between anchors
    expect(aligned.words[1].start).toBeGreaterThanOrEqual(0.4);
    expect(aligned.words[1].end).toBeLessThanOrEqual(1.5);
  });

  it("tolerates ASR misspellings via fuzzy matching", () => {
    const transcript = asr([
      ["the", 0],
      ["duke", 0.5],
      ["of", 1],
      ["welington", 1.5],
      ["held", 2],
    ]);
    const aligned = alignScriptToTranscript("The Duke of Wellington held", transcript);
    expect(aligned.words[3].start).toBe(1.5);
  });

  it("produces monotonic timestamps", () => {
    const script = "Ada Lovelace was born in London in 1815 the daughter of the poet Lord Byron. She never met her father.";
    const aligned = alignScriptToTranscript(script, mockTranscript(20, script.replace("London", "Londin")));
    for (let i = 1; i < aligned.words.length; i++) {
      expect(aligned.words[i].start).toBeGreaterThanOrEqual(aligned.words[i - 1].start);
    }
  });
});
