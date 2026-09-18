import path from "node:path";
import { HttpError, handleError, json, type Params } from "@/lib/api";
import { parseCues } from "@/lib/pipeline/cues";
import { startManualJob } from "@/lib/pipeline";
import { saveUploadedImage } from "@/lib/pipeline/images";
import { requireProject, updateProject } from "@/lib/storage/projects";
import type { ImageCandidate } from "@/lib/types";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

function imageKey(name: string): string {
  return (name.split(/[\\/]/).pop()?.toLocaleLowerCase() ?? "").replace(/\.[^.]+$/, "");
}

function validateImageRefs(cues: ReturnType<typeof parseCues>, images: File[]): void {
  for (const cue of cues) {
    const indexText = cue.image.startsWith("#") ? cue.image.slice(1) : cue.image;
    const validIndex = /^\d+$/.test(indexText) && Number(indexText) >= 1 && Number(indexText) <= images.length;
    const lower = cue.image.toLocaleLowerCase();
    const validName = images.some((file) => file.name.toLocaleLowerCase() === lower || imageKey(file.name) === imageKey(cue.image));
    if (!validIndex && !validName) {
      throw new HttpError(400, `Line ${cue.line}: unknown image "${cue.image}" (available: ${images.map((file) => file.name).join(", ")})`);
    }
  }
}

export async function POST(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    const project = await requireProject(id);
    if (!project.mediaPath || !project.mediaDuration) throw new HttpError(400, "Upload narration audio before creating a manual timeline");

    const form = await req.formData();
    const files = form.getAll("images");
    const images = files.filter((file): file is File => file instanceof File && file.size > 0);
    if (!images.length) throw new HttpError(400, "At least one image is required");
    for (const file of images) {
      if (!file.type.startsWith("image/")) throw new HttpError(400, "Only image files are accepted");
      if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image too large");
    }

    const scriptValue = form.get("script");
    const script = typeof scriptValue === "string" && scriptValue.trim() ? scriptValue.trim() : undefined;
    const cueValue = form.get("cues");
    let cueText = typeof cueValue === "string" ? cueValue.trim() : "";
    if (!cueText) {
      if (images.length !== 1) throw new HttpError(400, "Cues are required when uploading multiple images");
      cueText = "0-end 1";
    }
    let parsed;
    try {
      parsed = parseCues(cueText);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : String(err));
    }
    validateImageRefs(parsed, images);

    const candidates: ImageCandidate[] = [];
    for (const file of images) {
      candidates.push(await saveUploadedImage(id, "manual", Buffer.from(await file.arrayBuffer()), path.basename(file.name)));
    }
    const updated = await updateProject(id, (p) => {
      p.manualImages = candidates;
      p.cueText = cueText;
      p.script = script;
      p.timeline = [];
      p.renderStatus = "idle";
      p.outputVideoPath = undefined;
    });
    const job = startManualJob(id, { cues: cueText, script });
    return json({ project: updated, job }, 202);
  } catch (err) {
    return handleError(err);
  }
}
