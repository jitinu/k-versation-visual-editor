import { NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/storage";
import type { VisualFrequency } from "@/lib/types";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await getProject(id));
  } catch {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const project = await getProject(id);
    const body = (await request.json()) as {
      title?: string;
      visualFrequency?: VisualFrequency;
    };
    const visualFrequency = body.visualFrequency;
    return NextResponse.json(
      await saveProject({
        ...project,
        title: body.title?.trim() || project.title,
        visualFrequency:
          visualFrequency &&
          ["minimal", "balanced", "frequent"].includes(visualFrequency)
            ? visualFrequency
            : project.visualFrequency,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Project update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
