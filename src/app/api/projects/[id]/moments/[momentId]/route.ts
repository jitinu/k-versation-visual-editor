import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  getProject,
  projectUploadDir,
  toDataRelativePath,
  updateProject,
} from "@/lib/storage";
import type { ImageCandidate } from "@/lib/types";
import {
  createId,
  normalizeVisualInterval,
  safeFileName,
} from "@/lib/utils";

export const runtime = "nodejs";

const maxReplacementImageBytes = 25 * 1024 * 1024;
const multipartOverheadBytes = 1024 * 1024;

interface Context {
  params: Promise<{ id: string; momentId: string }>;
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id, momentId } = await context.params;
    const body = (await request.json()) as {
      chosenImageId?: string;
      removed?: boolean;
      startTime?: number;
      endTime?: number;
    };
    const updated = await updateProject(id, (current) => {
      const currentVisual = current.visuals.find(
        (entry) => entry.id === momentId,
      );
      if (!currentVisual) {
        throw new Error("Visual moment not found");
      }
      if (
        body.chosenImageId &&
        !currentVisual.candidates.some(
          (candidate) => candidate.id === body.chosenImageId,
        )
      ) {
        throw new Error("Image is not an alternative for this moment");
      }
      const { startTime, endTime } = normalizeVisualInterval(
        currentVisual.startTime,
        currentVisual.endTime,
        typeof body.startTime === "number" ? body.startTime : undefined,
        typeof body.endTime === "number" ? body.endTime : undefined,
        current.duration,
      );
      return {
        ...current,
        outputVideoPath: undefined,
        status: "generated",
        statusMessage: "Timeline updated; export again when ready",
        visuals: current.visuals.map((entry) =>
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
      };
    });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Timeline update failed";
    return NextResponse.json(
      { error: message },
      { status: message === "Visual moment not found" ? 404 : 400 },
    );
  }
}

export async function POST(request: Request, context: Context) {
  let destination: string | undefined;
  try {
    const { id, momentId } = await context.params;
    const project = await getProject(id);
    const visual = project.visuals.find((entry) => entry.id === momentId);
    if (!visual) {
      return NextResponse.json({ error: "Visual moment not found" }, { status: 404 });
    }
    const contentLength = Number(request.headers.get("content-length"));
    if (
      !Number.isFinite(contentLength) ||
      contentLength <= 0 ||
      contentLength >
        maxReplacementImageBytes + multipartOverheadBytes
    ) {
      return NextResponse.json(
        { error: "Replacement image request is too large or unbounded" },
        { status: 413 },
      );
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
    if (image.size > maxReplacementImageBytes) {
      return NextResponse.json({ error: "Replacement images must be under 25 MB" }, { status: 413 });
    }
    const directory = path.join(projectUploadDir(id), "replacements");
    await mkdir(directory, { recursive: true });
    destination = path.join(
      directory,
      `${createId("replacement")}-${safeFileName(image.name)}`,
    );
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
      await updateProject(id, (current) => {
        if (!current.visuals.some((entry) => entry.id === momentId)) {
          throw new Error("Visual moment not found");
        }
        return {
          ...current,
          outputVideoPath: undefined,
          status: "generated",
          statusMessage: "Replacement image selected",
          visuals: current.visuals.map((entry) =>
            entry.id === momentId
              ? {
                  ...entry,
                  candidates: [candidate, ...entry.candidates],
                  chosenImageId: candidate.id,
                  removed: false,
                }
              : entry,
          ),
        };
      }),
    );
  } catch (error) {
    if (destination) {
      await rm(destination, { force: true }).catch(() => undefined);
    }
    const message = error instanceof Error ? error.message : "Image upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
