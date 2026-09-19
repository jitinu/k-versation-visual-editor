import path from "node:path";
import { HttpError, handleError, json, type Params } from "@/lib/api";
import { extensionFor, resolveInProject, safeFileName, writeProjectFile } from "@/lib/storage/files";
import { requireProject, updateProject } from "@/lib/storage/projects";
import { probeDuration } from "@/lib/pipeline/media";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

const log = createLogger("upload");

const ALLOWED_EXT = new Set(["mp3", "wav", "m4a", "mp4", "mov", "aac", "ogg", "flac", "webm"]);
const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

export async function POST(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    await requireProject(id);
    const form = await req.formData();
    const media = form.get("media");
    const script = form.get("script");
    const scriptFile = form.get("scriptFile");
    const title = form.get("title");
    const frequency = form.get("frequency");

    let mediaRel: string | undefined;
    let mediaName: string | undefined;
    let duration: number | undefined;

    if (media instanceof File && media.size > 0) {
      if (media.size > MAX_BYTES) throw new HttpError(413, "File exceeds 1 GB limit");
      const ext = (path.extname(media.name).slice(1) || extensionFor(media.type, "")).toLowerCase();
      if (!ALLOWED_EXT.has(ext)) throw new HttpError(400, `Unsupported file type .${ext}`);
      mediaName = safeFileName(media.name);
      mediaRel = path.join("media", `source.${ext}`);
      await writeProjectFile(id, mediaRel, Buffer.from(await media.arrayBuffer()));
      duration = await probeDuration(resolveInProject(id, mediaRel));
      log.info("stored media", { id, mediaName, bytes: media.size, duration });
    }

    let scriptText: string | undefined;
    if (typeof script === "string" && script.trim()) scriptText = script.trim();
    if (scriptFile instanceof File && scriptFile.size > 0) {
      if (scriptFile.size > 2 * 1024 * 1024) throw new HttpError(413, "Script too large");
      scriptText = (await scriptFile.text()).trim();
    }

    const project = await updateProject(id, (p) => {
      if (mediaRel) {
        p.mediaPath = mediaRel;
        p.mediaOriginalName = mediaName;
        p.mediaDuration = duration;
        p.transcript = undefined;
        p.alignedTranscript = undefined;
        p.timeline = [];
        p.renderStatus = "idle";
        p.outputVideoPath = undefined;
      }
      if (scriptText !== undefined) p.script = scriptText;
      if (typeof title === "string" && title.trim()) p.title = title.trim();
      if (frequency === "minimal" || frequency === "balanced" || frequency === "frequent") p.frequency = frequency;
    });
    return json(project);
  } catch (err) {
    return handleError(err);
  }
}
