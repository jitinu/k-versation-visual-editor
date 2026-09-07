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

describe("project storage", () => {
  it("serializes concurrent read-modify-write operations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "k-versation-"));
    directories.push(directory);
    vi.stubEnv("K_VERSATION_DATA_DIR", directory);
    const { getProject, saveProject, updateProject } = await import(
      "@/lib/storage"
    );
    const now = new Date().toISOString();
    const project: Project = {
      id: "project_concurrency",
      title: "Concurrent project",
      visualFrequency: "minimal",
      mediaOriginalName: "audio.wav",
      mediaPath: "uploads/project_concurrency/audio.wav",
      mediaMimeType: "audio/wav",
      transcript: [],
      visuals: [],
      status: "ready",
      statusMessage: "Ready",
      duration: 0,
      createdAt: now,
      updatedAt: now,
    };
    await saveProject(project);

    await Promise.all(
      Array.from({ length: 20 }, () =>
        updateProject(project.id, async (current) => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          return { ...current, duration: current.duration + 1 };
        }),
      ),
    );

    expect((await getProject(project.id)).duration).toBe(20);
  });
});
