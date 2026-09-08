import { HttpError, handleError, json, type Params } from "@/lib/api";
import { saveUploadedImage } from "@/lib/pipeline/images";
import { requireProject, updateProject } from "@/lib/storage/projects";
import { assertSafeSegment } from "@/lib/storage/files";

export const runtime = "nodejs";

/** Manual image upload for a timeline entry; becomes the chosen image. */
export async function POST(req: Request, { params }: Params<{ id: string; entryId: string }>) {
  try {
    const { id, entryId } = await params;
    assertSafeSegment(entryId);
    const project = await requireProject(id);
    if (!project.timeline.some((t) => t.id === entryId)) throw new HttpError(404, "Timeline entry not found");
    const form = await req.formData();
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) throw new HttpError(400, "image file required");
    if (!file.type.startsWith("image/")) throw new HttpError(400, "Only image files are accepted");
    if (file.size > 30 * 1024 * 1024) throw new HttpError(413, "Image too large");
    const candidate = await saveUploadedImage(id, entryId, Buffer.from(await file.arrayBuffer()), file.name);
    const updated = await updateProject(id, (p) => {
      const e = p.timeline.find((t) => t.id === entryId)!;
      e.candidates.unshift(candidate);
      e.chosenCandidateId = candidate.id;
      e.status = "manual";
      e.confidence = 1;
      if (p.renderStatus === "done") p.renderStatus = "idle";
    });
    return json(updated);
  } catch (err) {
    return handleError(err);
  }
}
