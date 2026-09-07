export type VisualFrequency = "minimal" | "balanced" | "frequent";

export type ProjectStatus =
  | "ready"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "searching"
  | "selecting"
  | "generated"
  | "rendering"
  | "complete"
  | "error";

export type VisualType =
  | "photo"
  | "map"
  | "portrait"
  | "document"
  | "infographic"
  | "other";

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface ImageCandidate {
  id: string;
  title: string;
  imageUrl: string;
  thumbnailUrl: string;
  sourceUrl: string;
  sourceName: string;
  width: number;
  height: number;
  license?: string;
  attribution?: string;
  score: number;
  localPath?: string;
}

export interface VisualMoment {
  id: string;
  startTime: number;
  endTime: number;
  transcriptExcerpt: string;
  visualPriorityScore: number;
  whyVisualIsHelpful: string;
  searchQueries: [string, string, string];
  suggestedVisualType: VisualType;
  confidence: number;
  candidates: ImageCandidate[];
  chosenImageId?: string;
  removed: boolean;
}

export interface Project {
  id: string;
  title: string;
  visualFrequency: VisualFrequency;
  mediaOriginalName: string;
  mediaPath: string;
  mediaMimeType: string;
  script?: string;
  transcript: TranscriptSegment[];
  transcriptSource?: "openai" | "script-alignment" | "demo";
  visuals: VisualMoment[];
  status: ProjectStatus;
  statusMessage: string;
  duration: number;
  outputVideoPath?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  status: ProjectStatus;
  duration: number;
  visualCount: number;
  mediaOriginalName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateVisualMoment {
  start_time: number;
  end_time: number;
  transcript_excerpt: string;
  visual_priority_score: number;
  why_visual_is_helpful: string;
  search_query_1: string;
  search_query_2: string;
  search_query_3: string;
  suggested_visual_type: VisualType;
}
