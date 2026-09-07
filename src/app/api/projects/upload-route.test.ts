import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock("@/lib/storage");
  vi.unstubAllEnvs();
  vi.resetModules();
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function dataDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "k-versation-"));
  directories.push(directory);
  vi.stubEnv("K_VERSATION_DATA_DIR", directory);
  return directory;
}

function uploadRequest(form: FormData): Request {
  return new Request("http://localhost/api/projects", {
    method: "POST",
    body: form,
    headers: { "content-length": String(7 * 1024 * 1024) },
  });
}

describe("project uploads", () => {
  it("validates script size before creating an upload directory", async () => {
    const directory = await dataDirectory();
    const form = new FormData();
    form.set("media", new File(["audio"], "audio.wav"));
    form.set("script", "x".repeat(5 * 1024 * 1024 + 1));
    const { POST } = await import("@/app/api/projects/route");

    const response = await POST(uploadRequest(form));

    expect(response.status).toBe(413);
    expect(await readdir(path.join(directory, "uploads"))).toEqual([]);
  });

  it("rejects oversized requests before parsing multipart data", async () => {
    await dataDirectory();
    const request = new Request("http://localhost/api/projects", {
      method: "POST",
      body: new FormData(),
      headers: { "content-length": String(2 * 1024 * 1024 * 1024) },
    });
    const formData = vi.spyOn(request, "formData");
    const { POST } = await import("@/app/api/projects/route");

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
  });

  it("removes the new upload directory when project persistence fails", async () => {
    const directory = await dataDirectory();
    vi.doMock("@/lib/storage", async () => {
      const actual = await vi.importActual<typeof import("@/lib/storage")>(
        "@/lib/storage",
      );
      return {
        ...actual,
        saveProject: vi.fn().mockRejectedValue(new Error("Save failed")),
      };
    });
    const form = new FormData();
    form.set("media", new File(["audio"], "audio.wav"));
    const { POST } = await import("@/app/api/projects/route");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(uploadRequest(form));

    expect(response.status).toBe(500);
    expect(await readdir(path.join(directory, "uploads"))).toEqual([]);
    consoleError.mockRestore();
  });
});
