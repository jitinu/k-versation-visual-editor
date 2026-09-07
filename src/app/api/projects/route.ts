import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  ensureDataDirectories,
  listProjects,
  projectUploadDir,
  saveProject,
  toDataRelativePath,
} from "@/lib/storage";
import type { Project, VisualFrequency } from "@/lib/types";
import { createId, safeFileName } from "@/lib/utils";

export const runtime = "nodejs";

const allowedExtensions = new Set([".mp3", ".wav", ".m4a", ".mp4", ".mov"]);
const maxScriptBytes = 5 * 1024 * 1024;
const multipartOverheadBytes = 1024 * 1024;

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(request: Request) {
  let uploadDir: string | undefined;
  try {
    await ensureDataDirectories();
    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = Number(contentLengthHeader);
    if (
      !contentLengthHeader ||
      !Number.isFinite(contentLength) ||
      contentLength < 0
    ) {
      return NextResponse.json(
        { error: "A valid Content-Length header is required" },
        { status: 411 },
      );
    }
    if (
      contentLength >
      config.maxUploadBytes + maxScriptBytes + multipartOverheadBytes
    ) {
      return NextResponse.json(
        { error: "The upload exceeds the configured request limit" },
        { status: 413 },
      );
    }
    const form = await request.formData();
    const media = form.get("media");
    if (!(media instanceof File) || media.size === 0) {
      return NextResponse.json({ error: "Audio or video file is required" }, { status: 400 });
    }
    if (media.size > config.maxUploadBytes) {
      return NextResponse.json({ error: "The uploaded file exceeds the configured limit" }, { status: 413 });
    }
    const extension = path.extname(media.name).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return NextResponse.json({ error: "Supported formats: mp3, wav, m4a, mp4, mov" }, { status: 400 });
    }

    const pastedScript = String(form.get("script") ?? "").trim();
    const scriptFile = form.get("scriptFile");
    if (Buffer.byteLength(pastedScript, "utf8") > maxScriptBytes) {
      return NextResponse.json(
        { error: "Pasted scripts must be under 5 MB" },
        { status: 413 },
      );
    }
    if (scriptFile instanceof File && scriptFile.size > maxScriptBytes) {
      return NextResponse.json(
        { error: "Script files must be under 5 MB" },
        { status: 413 },
      );
    }
    let script = pastedScript;
    if (!script && scriptFile instanceof File && scriptFile.size > 0) {
      script = await scriptFile.text();
    }

    const projectId = createId("project");
    uploadDir = projectUploadDir(projectId);
    await mkdir(uploadDir, { recursive: true });
    const mediaPath = path.join(uploadDir, safeFileName(media.name));
    await writeFile(mediaPath, Buffer.from(await media.arrayBuffer()));

    const now = new Date().toISOString();
    const visualFrequency = String(form.get("visualFrequency") ?? "minimal");
    const project: Project = {
      id: projectId,
      title: String(form.get("title") ?? "").trim() || media.name.replace(extension, ""),
      visualFrequency: ["minimal", "balanced", "frequent"].includes(visualFrequency)
        ? (visualFrequency as VisualFrequency)
        : "minimal",
      mediaOriginalName: media.name,
      mediaPath: toDataRelativePath(mediaPath),
      mediaMimeType: media.type || "application/octet-stream",
      script: script || undefined,
      transcript: [],
      visuals: [],
      status: "ready",
      statusMessage: "Ready to generate",
      duration: 0,
      createdAt: now,
      updatedAt: now,
    };
    return NextResponse.json(await saveProject(project), { status: 201 });
  } catch (error) {
    if (uploadDir) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Upload failed";
    console.error("Project upload failed.", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
