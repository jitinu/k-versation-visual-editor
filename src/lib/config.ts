import path from "node:path";

const root = process.cwd();

export const config = {
  dataDir: path.resolve(
    /* turbopackIgnore: true */
    process.env.VISUAL_STORY_MAKER_DATA_DIR ??
      process.env.K_VERSATION_DATA_DIR ??
      path.join(root, "data"),
  ),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 1024) * 1024 * 1024,
  openAiApiKey: process.env.OPENAI_API_KEY,
  openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "whisper-1",
  analysisModel: process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-4.1-mini",
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
};
