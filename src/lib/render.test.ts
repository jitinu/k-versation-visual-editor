import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "@/lib/types";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("renderProjectVideo", () => {
  it("clears the previous export when a rerender fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "k-versation-"));
    directories.push(directory);
    vi.stubEnv("K_VERSATION_DATA_DIR", directory);
    const { saveProject } = await import("@/lib/storage");
    const { renderProjectVideo } = await import("@/lib/export");
    const now = new Date().toISOString();
    const project: Project = {
      id: "project_render_failure",
      title: "Render failure",
      visualFrequency: "minimal",
      mediaOriginalName: "audio.wav",
      mediaPath: "uploads/project_render_failure/audio.wav",
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
              id: "unsafe",
              title: "Unsafe",
              imageUrl: "http://127.0.0.1/image.jpg",
              thumbnailUrl: "http://127.0.0.1/thumb.jpg",
              sourceUrl: "",
              sourceName: "Untrusted",
              width: 1200,
              height: 800,
              score: 100,
            },
          ],
          chosenImageId: "unsafe",
          removed: false,
        },
      ],
      status: "complete",
      statusMessage: "Export complete",
      duration: 10,
      outputVideoPath:
        "renders/project_render_failure/k-versation-export.mp4",
      createdAt: now,
      updatedAt: now,
    };
    await saveProject(project);

    const result = await renderProjectVideo(project.id);

    expect(result.status).toBe("error");
    expect(result.outputVideoPath).toBeUndefined();
  });
});
