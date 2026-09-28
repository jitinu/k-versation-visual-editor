import { z } from "zod";
import { HttpError, handleError, json, type Params } from "@/lib/api";
import { normalizeTimeline } from "@/lib/pipeline/timeline";
import { updateProject } from "@/lib/storage/projects";

export const runtime = "nodejs";

const schema = z.object({
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
  chosenCandidateId: z.string().nullable().optional(),
  removed: z.boolean().optional(),
  kenBurns: z.boolean().optional(),
  excerpt: z.string().max(2000).optional(),
});

export async function PATCH(req: Request, { params }: Params<{ id: string; entryId: string }>) {
  try {
    const { id, entryId } = await params;
    const body = schema.parse(await req.json());
    const project = await updateProject(id, (p) => {
      const e = p.timeline.find((t) => t.id === entryId);
      if (!e) throw new HttpError(404, "Timeline entry not found");
      if (body.start !== undefined) e.start = +body.start.toFixed(2);
      if (body.end !== undefined) e.end = +body.end.toFixed(2);
      if (e.end <= e.start) e.end = +(e.start + 1).toFixed(2);
      if (p.mediaDuration) e.end = Math.min(e.end, p.mediaDuration);
      if (body.chosenCandidateId !== undefined) {
        if (body.chosenCandidateId && !e.candidates.some((c) => c.id === body.chosenCandidateId))
          throw new HttpError(400, "Unknown candidate");
        e.chosenCandidateId = body.chosenCandidateId;
        e.status = body.chosenCandidateId ? "manual" : "skipped";
        if (body.chosenCandidateId) e.confidence = Math.max(e.confidence, 0.9);
      }
      if (body.removed !== undefined) e.removed = body.removed;
      if (body.kenBurns !== undefined) e.kenBurns = body.kenBurns;
      if (body.excerpt !== undefined) e.excerpt = body.excerpt;
      p.timeline = normalizeTimeline(p.timeline);
      if (p.renderStatus === "done") p.renderStatus = "idle";
    });
    return json(project);
  } catch (err) {
    return handleError(err);
  }
}
