import { z } from "zod";
import { HttpError, handleError, json, type Params } from "@/lib/api";
import { startGenerateJob } from "@/lib/pipeline";
import { requireProject } from "@/lib/storage/projects";

export const runtime = "nodejs";

const schema = z.object({
  frequency: z.enum(["minimal", "balanced", "frequent"]).optional(),
  /** re-run analysis/search using the existing transcript */
  skipTranscription: z.boolean().optional(),
});

export async function POST(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    const project = await requireProject(id);
    if (!project.mediaPath) throw new HttpError(400, "Upload an audio or video file first");
    const body = schema.parse(await req.json().catch(() => ({})));
    const job = startGenerateJob(id, body);
    return json({ job }, 202);
  } catch (err) {
    return handleError(err);
  }
}
