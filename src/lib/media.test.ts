import { describe, expect, it } from "vitest";
import { interpolateTime } from "@/lib/media";
import type { TranscriptSegment } from "@/lib/types";

describe("interpolateTime", () => {
  it("keeps script boundaries monotonic through transcript silence", () => {
    const transcript: TranscriptSegment[] = [
      { id: "first", start: 5, end: 10, text: "First" },
      { id: "second", start: 20, end: 30, text: "Second" },
    ];
    const fractions = [0.02, 0.1, 0.15, 0.2, 0.5, 1];

    const boundaries = fractions.map((fraction) =>
      interpolateTime(transcript, fraction, 100),
    );

    expect(boundaries).toEqual([2, 10, 15, 20, 50, 100]);
    expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b));
  });
});
