import { NextResponse } from "next/server";
import { generateProject } from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      lowConfidenceOnly?: boolean;
    };
    const project = await generateProject(id, body.lowConfidenceOnly === true);
    return NextResponse.json(project, { status: project.status === "error" ? 500 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
