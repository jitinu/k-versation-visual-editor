import path from "node:path";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && process.env[name] ? v : fallback;
}

export type TranscriptionProvider = "local" | "openai" | "whisperx" | "mock";
export type LlmProvider = "openai" | "ollama" | "mock";
export type SearchProvider = "wikimedia" | "openverse" | "duckduckgo" | "serpapi" | "bing" | "google" | "mock";

const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
const llmProvider = env("LLM_PROVIDER", hasOpenAiKey ? "openai" : "ollama") as LlmProvider;
const ollamaBaseUrl = env("OLLAMA_BASE_URL", "http://localhost:11434/v1");

export const config = {
  dataDir: path.resolve(env("K_VERSATION_DATA_DIR", path.join(process.cwd(), "data"))),
  storageBackend: env("STORAGE_BACKEND", "local") as "local" | "s3",
  s3: {
    bucket: env("S3_BUCKET"),
    region: env("S3_REGION"),
    endpoint: env("S3_ENDPOINT"),
    publicBaseUrl: env("S3_PUBLIC_BASE_URL"),
  },

  openai: {
    apiKey: env("OPENAI_API_KEY"),
    baseUrl: env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    transcriptionModel: env("OPENAI_TRANSCRIPTION_MODEL", "whisper-1"),
    textModel: env("LLM_MODEL", "gpt-4o-mini"),
    visionModel: env("VISION_MODEL", "gpt-4o-mini"),
  },

  transcription: {
    provider: env("TRANSCRIPTION_PROVIDER", hasOpenAiKey ? "openai" : "local") as TranscriptionProvider,
    whisperxUrl: env("WHISPERX_URL"),
    /** faster-whisper (local, free): model size and compute device */
    localModel: env("LOCAL_WHISPER_MODEL", "small"),
    localDevice: env("LOCAL_WHISPER_DEVICE", "cpu"),
    localComputeType: env("LOCAL_WHISPER_COMPUTE_TYPE", "int8"),
    pythonPath: env("PYTHON_PATH", "python3"),
  },
  /** Chat/vision endpoint actually used for analysis, titles and ranking (OpenAI-compatible). */
  llm: {
    provider: llmProvider,
    baseUrl: llmProvider === "ollama" ? ollamaBaseUrl : env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    apiKey: llmProvider === "ollama" ? env("OLLAMA_API_KEY", "ollama") : env("OPENAI_API_KEY"),
    textModel: llmProvider === "ollama" ? env("OLLAMA_MODEL", "llama3.1") : env("LLM_MODEL", "gpt-4o-mini"),
    visionModel: llmProvider === "ollama" ? env("OLLAMA_VISION_MODEL", "llava") : env("VISION_MODEL", "gpt-4o-mini"),
  },
  vision: {
    enabled: bool("VISION_RANKING_ENABLED", llmProvider !== "mock"),
    maxCandidatesPerMoment: num("VISION_MAX_CANDIDATES", 8),
    minConfidence: num("VISION_MIN_CONFIDENCE", 0.55),
  },
  search: {
    providers: env("IMAGE_SEARCH_PROVIDERS", "wikimedia,openverse,duckduckgo")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as SearchProvider[],
    serpApiKey: env("SERPAPI_API_KEY"),
    bingApiKey: env("BING_IMAGE_SEARCH_KEY"),
    googleApiKey: env("GOOGLE_CSE_API_KEY"),
    googleCx: env("GOOGLE_CSE_CX"),
    minCandidates: num("SEARCH_MIN_CANDIDATES", 8),
    maxCandidates: num("SEARCH_MAX_CANDIDATES", 20),
    retries: num("SEARCH_RETRIES", 3),
    timeoutMs: num("SEARCH_TIMEOUT_MS", 15000),
  },
  filter: {
    minWidth: num("IMAGE_MIN_WIDTH", 800),
    minHeight: num("IMAGE_MIN_HEIGHT", 500),
  },
  render: {
    ffmpegPath: env("FFMPEG_PATH", "ffmpeg"),
    ffprobePath: env("FFPROBE_PATH", "ffprobe"),
    width: num("RENDER_WIDTH", 1920),
    height: num("RENDER_HEIGHT", 1080),
    kenBurns: bool("RENDER_KEN_BURNS", false),
    burnSubtitles: bool("RENDER_BURN_SUBTITLES", false),
    fadeDuration: num("RENDER_FADE_SECONDS", 0.5),
  },
  logLevel: env("LOG_LEVEL", "info"),
};

export type AppConfig = typeof config;

export function describeProviders() {
  return {
    transcription: config.transcription.provider,
    llm: config.llm.provider,
    vision: config.vision.enabled && config.llm.provider !== "mock" ? config.llm.provider : "disabled",
    search: config.search.providers,
    storage: config.storageBackend,
    mock: config.llm.provider === "mock" || config.transcription.provider === "mock",
  };
}
