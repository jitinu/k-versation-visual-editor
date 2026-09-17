import path from "node:path";
import { HttpError, handleError, json, type Params } from "@/lib/api";
import { startRenderJob } from "@/lib/pipeline";
import { saveUploadedImage } from "@/lib/pipeline/images";
import { requireProject, updateProject } from "@/lib/storage/projects";

export const runtime = "nodejs";

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

export async function POST(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    const project = await requireProject(id);
    if (!project.mediaPath || !project.mediaDuration) {
      throw new HttpError(400, "Upload narration audio before creating a simple video");
    }

    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "image file required");
    if (!file.type.startsWith("image/")) throw new HttpError(400, "Only image files are accepted");
    if (file.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Image too large");

    const candidate = await saveUploadedImage(id, "simple", Buffer.from(await file.arrayBuffer()), file.name);
    const updated = await updateProject(id, (p) => {
      const entry = {
        id: "simple",
        start: 0,
        end: p.mediaDuration!,
        excerpt: "",
        reason: "Single image for the full narration",
        visualType: "photo" as const,
        priority: 1,
        confidence: 1,
        status: "manual" as const,
        searchQueries: [],
        chosenCandidateId: candidate.id,
        candidates: [candidate],
      };
      p.timeline = [entry];
      p.renderStatus = "idle";
      p.outputVideoPath = undefined;
      if ((!p.title || p.title === "Untitled project") && p.mediaOriginalName) {
        p.title = path.basename(p.mediaOriginalName, path.extname(p.mediaOriginalName));
      }
    });
    const job = startRenderJob(id);
    return json({ project: updated, job }, 202);
  } catch (err) {
    return handleError(err);
  }
}
