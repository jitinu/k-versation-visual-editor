import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getProject,
  projectUploadDir,
  saveProject,
  toDataRelativePath,
} from "@/lib/storage";
import type { ImageCandidate } from "@/lib/types";
import { clamp, createId, safeFileName } from "@/lib/utils";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string; momentId: string }>;
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id, momentId } = await context.params;
    const project = await getProject(id);
    const body = (await request.json()) as {
      chosenImageId?: string;
      removed?: boolean;
      startTime?: number;
      endTime?: number;
    };
    const visual = project.visuals.find((entry) => entry.id === momentId);
    if (!visual) {
      return NextResponse.json({ error: "Visual moment not found" }, { status: 404 });
    }
    if (
      body.chosenImageId &&
      !visual.candidates.some((candidate) => candidate.id === body.chosenImageId)
    ) {
      return NextResponse.json({ error: "Image is not an alternative for this moment" }, { status: 400 });
    }
    const startTime =
      typeof body.startTime === "number"
        ? clamp(body.startTime, 0, project.duration)
        : visual.startTime;
    const endTime =
      typeof body.endTime === "number"
        ? clamp(body.endTime, startTime + 0.5, project.duration)
        : Math.max(visual.endTime, startTime + 0.5);
    const updated = await saveProject({
      ...project,
      outputVideoPath: undefined,
      status: "generated",
      statusMessage: "Timeline updated; export again when ready",
      visuals: project.visuals.map((entry) =>
        entry.id === momentId
          ? {
              ...entry,
              chosenImageId: body.chosenImageId ?? entry.chosenImageId,
              removed: body.removed ?? entry.removed,
              startTime,
              endTime,
            }
          : entry,
      ),
    });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timeline update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id, momentId } = await context.params;
    const project = await getProject(id);
    const visual = project.visuals.find((entry) => entry.id === momentId);
    if (!visual) {
      return NextResponse.json({ error: "Visual moment not found" }, { status: 404 });
    }
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: "Replacement image is required" }, { status: 400 });
    }
    const extension = path.extname(image.name).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".webp"].includes(extension)) {
      return NextResponse.json({ error: "Supported images: jpg, png, webp" }, { status: 400 });
    }
    if (image.size > 25 * 1024 * 1024) {
      return NextResponse.json({ error: "Replacement images must be under 25 MB" }, { status: 413 });
    }
    const directory = path.join(projectUploadDir(id), "replacements");
    await mkdir(directory, { recursive: true });
    const destination = path.join(directory, `${createId("replacement")}-${safeFileName(image.name)}`);
    await writeFile(destination, Buffer.from(await image.arrayBuffer()));
    const localPath = toDataRelativePath(destination);
    const candidate: ImageCandidate = {
      id: createId("image"),
      title: image.name,
      imageUrl: `/api/assets?path=${encodeURIComponent(localPath)}`,
      thumbnailUrl: `/api/assets?path=${encodeURIComponent(localPath)}`,
      sourceUrl: "",
      sourceName: "Your upload",
      width: 0,
      height: 0,
      score: 100,
      localPath,
    };
    return NextResponse.json(
      await saveProject({
        ...project,
        outputVideoPath: undefined,
        status: "generated",
        statusMessage: "Replacement image selected",
        visuals: project.visuals.map((entry) =>
          entry.id === momentId
            ? {
                ...entry,
                candidates: [candidate, ...entry.candidates],
                chosenImageId: candidate.id,
                removed: false,
              }
            : entry,
        ),
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
