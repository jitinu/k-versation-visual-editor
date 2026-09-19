import { HttpError, handleError, json, type Params } from "@/lib/api";
import { getJob } from "@/lib/jobs";
import { assertSafeSegment } from "@/lib/storage/files";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: Params<{ id: string }>) {
  try {
    const { id } = await params;
    assertSafeSegment(id);
    const job = await getJob(id);
    if (!job) throw new HttpError(404, "Job not found");
    return json(job);
  } catch (err) {
    return handleError(err);
  }
}
