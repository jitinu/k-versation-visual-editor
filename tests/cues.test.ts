import { describe, expect, it } from "vitest";
import { parseCues, parseTimestamp, resolveCues } from "@/lib/pipeline/cues";
import type { Transcript } from "@/lib/types";

const transcript: Transcript = {
  text: "The ordinary people visited Gwangjang Market and ate kimchi stew.",
  duration: 20,
  provider: "test",
  words: [
    { word: "The", start: 0, end: 0.5 },
    { word: "ordinary", start: 0.5, end: 1 },
    { word: "people", start: 1, end: 1.5 },
    { word: "visited", start: 1.5, end: 2 },
    { word: "Gwangjang", start: 2, end: 2.5 },
    { word: "Market", start: 2.5, end: 3 },
    { word: "and", start: 3, end: 3.5 },
    { word: "ate", start: 3.5, end: 4 },
    { word: "kimchi", start: 4, end: 4.5 },
    { word: "stew.", start: 4.5, end: 5 },
  ],
  segments: [],
};

describe("parseTimestamp", () => {
  it("parses seconds, minutes, and hours", () => {
    expect(parseTimestamp("12")).toBe(12);
    expect(parseTimestamp("0:12")).toBe(12);
    expect(parseTimestamp("1:05.5")).toBe(65.5);
    expect(parseTimestamp("01:02:03")).toBe(3723);
  });
});

describe("parseCues", () => {
  it("parses timestamp grammar and ignores comments", () => {
    expect(parseCues('# comment\n0:12-0:20 kimchi.jpg\n0:20 market.png 8.5s\n1:05-end 3')).toEqual([
      { kind: "time", image: "kimchi.jpg", start: 12, end: 20, line: 2 },
      { kind: "time", image: "market.png", start: 20, duration: 8.5, line: 3 },
      { kind: "time", image: "3", start: 65, line: 4 },
    ]);
  });

  it("parses phrase, end phrase, and duration grammar", () => {
    expect(parseCues('"Gwangjang Market" market.png 6s\n“Gwangjang Market” .. ‘kimchi stew’ 2')).toEqual([
      { kind: "phrase", image: "market.png", phrase: "Gwangjang Market", duration: 6, line: 1 },
      { kind: "phrase", image: "2", phrase: "Gwangjang Market", endPhrase: "kimchi stew", line: 2 },
    ]);
  });

  it("reports bad line numbers", () => {
    expect(() => parseCues("0:01 1\nbad line")).toThrow("Line 2:");
  });
});

describe("resolveCues", () => {
  it("resolves image indexes, fills until next/end, and truncates overlaps", () => {
    const cues = parseCues("0-10 #1\n8 2 4s\n15-end one.jpg");
    expect(resolveCues(cues, ["one.jpg", "two.png"], 20)).toEqual([
      { start: 0, end: 8, image: "one.jpg", line: 1 },
      { start: 8, end: 12, image: "two.png", line: 2 },
      { start: 15, end: 20, image: "one.jpg", line: 3 },
    ]);
  });

  it("resolves exact and fuzzy phrases, and rejects missing phrases", () => {
    expect(resolveCues(parseCues('"ordinary people" 1'), ["market.jpg"], 20, transcript)[0]).toMatchObject({ start: 0.5, end: 20 });
    expect(resolveCues(parseCues('"ordnary people" 1 2s'), ["market.jpg"], 20, transcript)[0]).toMatchObject({ start: 0.5, end: 2.5 });
    expect(() => resolveCues(parseCues('"not present" 1'), ["market.jpg"], 20, transcript)).toThrow('Line 1: phrase "not present" not found in narration');
  });

  it("requires a transcript for phrase cues", () => {
    expect(() => resolveCues(parseCues('"ordinary people" 1'), ["market.jpg"], 20)).toThrow("Phrase cues require a transcript");
  });
});
