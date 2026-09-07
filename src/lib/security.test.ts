import { describe, expect, it } from "vitest";
import { trustedImageUrl } from "@/lib/export";
import { projectOwnsAsset } from "@/lib/storage";
import type { Project } from "@/lib/types";

const project: Project = {
  id: "project_security",
  title: "Security test",
  visualFrequency: "minimal",
  mediaOriginalName: "audio.wav",
  mediaPath: "uploads/project_security/audio.wav",
  mediaMimeType: "audio/wav",
  transcript: [],
  visuals: [
    {
      id: "moment",
      startTime: 0,
      endTime: 5,
      transcriptExcerpt: "Excerpt",
      visualPriorityScore: 80,
      whyVisualIsHelpful: "Useful",
      searchQueries: ["one", "two", "three"],
      suggestedVisualType: "photo",
      confidence: 0.8,
      candidates: [
        {
          id: "local",
          title: "Local image",
          imageUrl: "",
          thumbnailUrl: "",
          sourceUrl: "",
          sourceName: "Your upload",
          width: 0,
          height: 0,
          score: 100,
          localPath: "uploads/project_security/replacements/image.jpg",
        },
      ],
      chosenImageId: "local",
      removed: false,
    },
  ],
  status: "generated",
  statusMessage: "Ready",
  duration: 10,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("asset access", () => {
  it("allows only project media and referenced replacement images", () => {
    expect(projectOwnsAsset(project, project.mediaPath)).toBe(true);
    expect(
      projectOwnsAsset(
        project,
        "uploads/project_security/replacements/image.jpg",
      ),
    ).toBe(true);
    expect(
      projectOwnsAsset(project, "projects/project_security.json"),
    ).toBe(false);
    expect(
      projectOwnsAsset(project, "renders/project_security/export.mp4"),
    ).toBe(false);
    expect(
      projectOwnsAsset(project, "uploads/project_security/private.txt"),
    ).toBe(false);
  });
});

describe("remote image URLs", () => {
  it("accepts only HTTPS Wikimedia image URLs", () => {
    expect(
      trustedImageUrl("https://upload.wikimedia.org/example.jpg").hostname,
    ).toBe("upload.wikimedia.org");
    expect(
      trustedImageUrl("https://thumb.wikimedia.org/example.jpg").hostname,
    ).toBe("thumb.wikimedia.org");
    expect(() =>
      trustedImageUrl("http://upload.wikimedia.org/example.jpg"),
    ).toThrow();
    expect(() =>
      trustedImageUrl("https://upload.wikimedia.org.example.com/image.jpg"),
    ).toThrow();
    expect(() => trustedImageUrl("http://127.0.0.1/image.jpg")).toThrow();
  });

  it("validates redirect destinations against the same allowlist", () => {
    const base = new URL("https://upload.wikimedia.org/start.jpg");
    expect(trustedImageUrl("/next.jpg", base).hostname).toBe(
      "upload.wikimedia.org",
    );
    expect(() =>
      trustedImageUrl("http://169.254.169.254/latest/meta-data", base),
    ).toThrow();
  });
});
