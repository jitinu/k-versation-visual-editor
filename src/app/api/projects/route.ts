import { z } from "zod";
import { handleError, json } from "@/lib/api";
import { createProject, listProjects } from "@/lib/storage/projects";

export const runtime = "nodejs";

const createSchema = z.object({
  title: z.string().max(200).optional(),
  frequency: z.enum(["minimal", "balanced", "frequent"]).optional(),
  script: z.string().max(200_000).optional(),
});

export async function GET() {
  try {
    return json(await listProjects());
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: Request) {
  try {
    const body = createSchema.parse(await req.json().catch(() => ({})));
    return json(await createProject(body), 201);
  } catch (err) {
    return handleError(err);
  }
}
