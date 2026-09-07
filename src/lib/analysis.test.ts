import { describe, expect, it } from "vitest";
import { heuristicAnalysis } from "@/lib/analysis";
import type { TranscriptSegment } from "@/lib/types";

describe("heuristicAnalysis", () => {
  it("does not let a rejected candidate block a later valid moment", () => {
    const transcript: TranscriptSegment[] = [
      {
        id: "a",
        start: 0,
        end: 5,
        text: "In 1945 the Battle of Berlin changed modern Europe.",
      },
      {
        id: "b",
        start: 10,
        end: 15,
        text: "The Berlin Monument became a famous city landmark.",
      },
      {
        id: "c",
        start: 20,
        end: 25,
        text: "A mountain photograph documented the journey.",
      },
    ];

    const result = heuristicAnalysis(transcript, 2);

    expect(result.map((moment) => moment.start_time)).toEqual([0, 20]);
  });
});
