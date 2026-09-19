export type VisualFrequency = "minimal" | "balanced" | "frequent";

export type VisualType =
  | "photo"
  | "map"
  | "portrait"
  | "document"
  | "infographic"
  | "other";

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  language?: string;
  duration: number;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  provider: string;
  /** true when the transcript came from a script aligned to real audio */
  alignedFromScript?: boolean;
}

export interface CandidateMoment {
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

export interface ImageCandidate {
  id: string;
  imageUrl: string;
  thumbnailUrl?: string;
  sourcePageUrl: string;
  sourceName: string;
  title: string;
  domain: string;
  width?: number;
  height?: number;
  attribution?: string;
  license?: string;
  provider: string;
  authority: number;
  /** local path once downloaded (relative to project dir) */
  localPath?: string;
  prefilterScore?: number;
  visionScore?: number;
  visionReason?: string;
  rejected?: string;
  /** user uploaded image */
  manual?: boolean;
}

export type MomentStatus = "ok" | "skipped" | "manual";

export interface TimelineEntry {
  id: string;
  start: number;
  end: number;
  excerpt: string;
  reason: string;
  visualType: VisualType;
  priority: number;
  /** 0..1 – confidence of the chosen image */
  confidence: number;
  status: MomentStatus;
  searchQueries: string[];
  chosenCandidateId: string | null;
  candidates: ImageCandidate[];
  removed?: boolean;
  kenBurns?: boolean;
}

export type JobStage =
  | "queued"
  | "uploading"
  | "transcribing"
  | "analyzing"
  | "searching"
  | "selecting"
  | "rendering"
  | "done"
  | "error";

export interface JobState {
  id: string;
  type: "generate" | "render" | "regenerate";
  projectId: string;
  stage: JobStage;
  progress: number;
  message?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export type RenderStatus = "idle" | "queued" | "rendering" | "done" | "error";

export interface RenderSettings {
  width: number;
  height: number;
  kenBurns: boolean;
  burnSubtitles: boolean;
  fadeDuration: number;
}

export interface Project {
  id: string;
  title: string;
  generatedTitle?: string;
  mediaPath?: string;
  mediaOriginalName?: string;
  mediaDuration?: number;
  script?: string;
  frequency: VisualFrequency;
  transcript?: Transcript;
  alignedTranscript?: Transcript;
  candidateMoments?: CandidateMoment[];
  timeline: TimelineEntry[];
  renderStatus: RenderStatus;
  renderError?: string;
  renderSettings: RenderSettings;
  outputVideoPath?: string;
  lastJobId?: string;
  renderJobId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  renderStatus: RenderStatus;
  momentCount: number;
  createdAt: string;
  updatedAt: string;
}
