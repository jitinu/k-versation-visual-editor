import { z } from "zod";
import { handleError, json, type Params } from "@/lib/api";
import { requireProject, updateProject } from "@/lib/storage/projects";
import { normalizeTimeline } from "@/lib/pipeline/timeline";

export const runtime = "nodejs";

const patchSchema = z.object({
  title: z.string().max(200).optional(),
  frequency: z.enum(["minimal", "balanced", "frequent"]).optional(),
  script: z.string().max(200_000).nullable().optional(),
  renderSettings: z
    .object({
      width: z.number().int().min(320).max(3840).optional(),
      height: z.number().int().min(180).max(2160).optional(),
      kenBurns: z.boolean().optional(),
      burnSubtitles: z.boolean().optional(),
      fadeDuration: z.number().min(0).max(3).optional(),
    })
    .optional(),
});

export async function GET(_req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    return json(await requireProject(id));
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const project = await updateProject(id, (p) => {
      if (body.title !== undefined) p.title = body.title.trim() || p.title;
      if (body.frequency) p.frequency = body.frequency;
      if (body.script !== undefined) p.script = body.script?.trim() || undefined;
      if (body.renderSettings) {
        p.renderSettings = { ...p.renderSettings, ...body.renderSettings };
        if (p.renderStatus === "done") p.renderStatus = "idle";
      }
      p.timeline = normalizeTimeline(p.timeline);
    });
    return json(project);
  } catch (err) {
    return handleError(err);
  }
}
