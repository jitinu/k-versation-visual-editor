import { describe, expect, it } from "vitest";
import { mergeLowConfidenceVisuals } from "@/lib/pipeline";
import type { ImageCandidate, VisualMoment } from "@/lib/types";

function image(id: string): ImageCandidate {
  return {
    id,
    title: id,
    imageUrl: `https://upload.wikimedia.org/${id}.jpg`,
    thumbnailUrl: `https://upload.wikimedia.org/${id}-thumb.jpg`,
    sourceUrl: "https://commons.wikimedia.org/",
    sourceName: "Wikimedia Commons",
    width: 1200,
    height: 800,
    score: 80,
  };
}

function visual(
  id: string,
  confidence: number,
  candidates: ImageCandidate[],
): VisualMoment {
  return {
    id,
    startTime: id === "approved" ? 3 : 18,
    endTime: id === "approved" ? 9 : 25,
    transcriptExcerpt: `${id} excerpt`,
    visualPriorityScore: 75,
    whyVisualIsHelpful: "Useful",
    searchQueries: [id, `${id} photo`, `${id} Commons`],
    suggestedVisualType: "photo",
    confidence,
    candidates,
    chosenImageId: candidates[0]?.id,
    removed: id === "low",
  };
}

describe("mergeLowConfidenceVisuals", () => {
  it("preserves approved visuals and user-edited ordering and timing", () => {
    const approved = visual("approved", 0.9, [image("approved-image")]);
    const low = visual("low", 0.4, [image("old-image")]);
    const replacement = image("replacement");

    const result = mergeLowConfidenceVisuals(
      [approved, low],
      new Map([
        ["approved", { images: [image("ignored")], confidence: 0.95 }],
        ["low", { images: [replacement], confidence: 0.8 }],
      ]),
    );

    expect(result[0]).toBe(approved);
    expect(result[1]).toMatchObject({
      id: "low",
      startTime: 18,
      endTime: 25,
      removed: true,
      chosenImageId: "replacement",
      candidates: [replacement],
    });
  });
});
