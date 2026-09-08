import { z } from "zod";
import { handleError, json, type Params } from "@/lib/api";
import { startRegenerateJob } from "@/lib/pipeline";
import { requireProject } from "@/lib/storage/projects";

export const runtime = "nodejs";

const schema = z.object({
  entryIds: z.array(z.string()).optional(),
  all: z.boolean().optional(),
  lowConfidenceBelow: z.number().min(0).max(1).optional(),
  /** custom search queries for a manual re-search of a single entry */
  queries: z.array(z.string().min(1).max(200)).max(3).optional(),
});

export async function POST(req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    await requireProject(id);
    const body = schema.parse(await req.json());
    const job = startRegenerateJob(id, body);
    return json({ job }, 202);
  } catch (err) {
    return handleError(err);
  }
}
