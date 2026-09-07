import { describe, expect, it } from "vitest";
import { normalizeVisualInterval } from "@/lib/utils";

describe("normalizeVisualInterval", () => {
  it("moves a start in the final half second earlier", () => {
    expect(normalizeVisualInterval(5, 8, 9.9, undefined, 10)).toEqual({
      startTime: 9.5,
      endTime: 10,
    });
  });

  it("keeps both boundaries within short recordings", () => {
    expect(normalizeVisualInterval(0, 0.2, 0.3, 1, 0.4)).toEqual({
      startTime: 0,
      endTime: 0.4,
    });
  });
});
