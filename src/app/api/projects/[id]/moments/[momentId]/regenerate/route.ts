import { NextResponse } from "next/server";
import { findImagesForMoment } from "@/lib/images";
import { getProject, updateProject } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

interface Context {
  params: Promise<{ id: string; momentId: string }>;
}

export async function POST(request: Request, context: Context) {
  try {
    const { id, momentId } = await context.params;
    const project = await getProject(id);
    const visual = project.visuals.find((entry) => entry.id === momentId);
    if (!visual) {
      return NextResponse.json({ error: "Visual moment not found" }, { status: 404 });
    }
    const body = (await request.json().catch(() => ({}))) as { query?: string };
    const query = body.query?.trim();
    const images = await findImagesForMoment({
      start_time: visual.startTime,
      end_time: visual.endTime,
      transcript_excerpt: visual.transcriptExcerpt,
      visual_priority_score: visual.visualPriorityScore,
      why_visual_is_helpful: visual.whyVisualIsHelpful,
      search_query_1: query || visual.searchQueries[0],
      search_query_2: query ? `${query} ${visual.suggestedVisualType}` : visual.searchQueries[1],
      search_query_3: query ? `${query} Wikimedia Commons` : visual.searchQueries[2],
      suggested_visual_type: visual.suggestedVisualType,
    });
    if (images.length === 0) {
      return NextResponse.json({ error: "No strong alternatives were found" }, { status: 404 });
    }
    return NextResponse.json(
      await updateProject(id, (current) => ({
        ...current,
        outputVideoPath: undefined,
        status: "generated",
        statusMessage: "Segment alternatives regenerated",
        visuals: current.visuals.map((entry) =>
          entry.id === momentId
            ? {
                ...entry,
                candidates: images,
                chosenImageId: images[0].id,
                removed: false,
              }
            : entry,
        ),
      })),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
