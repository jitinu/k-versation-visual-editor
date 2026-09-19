import { config } from "../config";
import { createLogger } from "../logger";
import { withRetry } from "../util";

const log = createLogger("llm");

export class LlmUnavailableError extends Error {}

export type ChatContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } }>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

/**
 * Chat completions against any OpenAI-compatible endpoint (OpenAI, Ollama, LM Studio, ...).
 * Provider/base URL/model come from `config.llm`.
 */
function headers(): Record<string, string> {
  if (config.llm.provider === "mock") throw new LlmUnavailableError("LLM_PROVIDER=mock");
  if (!config.llm.apiKey) throw new LlmUnavailableError(`${config.llm.provider}: API key is not configured`);
  return {
    Authorization: `Bearer ${config.llm.apiKey}`,
    "Content-Type": "application/json",
  };
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${res.statusText}: ${text.slice(0, 300)}`;
}

/** JSON-mode chat completion. Returns the parsed JSON object. */
export async function chatJson<T>(
  messages: ChatMessage[],
  opts: { model?: string; temperature?: number; maxTokens?: number } = {},
): Promise<T> {
  const model = opts.model ?? config.llm.textModel;
  return withRetry(
    async () => {
      const res = await fetch(`${config.llm.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          model,
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 4000,
          response_format: { type: "json_object" },
          messages,
        }),
      });
      if (!res.ok) {
        const msg = await readError(res);
        if (res.status === 401 || res.status === 403) throw new LlmUnavailableError(msg);
        throw new Error(`${config.llm.provider} chat failed: ${msg}`);
      }
      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const content = json.choices?.[0]?.message?.content ?? "{}";
      return parseJsonLoose<T>(content);
    },
    {
      retries: 2,
      onRetry: (err, attempt) => log.warn(`chat retry ${attempt}`, err),
    },
  );
}

/** Local models sometimes wrap JSON in ``` fences or prose; extract the outermost object. */
export function parseJsonLoose<T>(content: string): T {
  try {
    return JSON.parse(content) as T;
  } catch {
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start === -1 || end <= start) throw new Error("LLM did not return JSON");
    return JSON.parse(content.slice(start, end + 1)) as T;
  }
}

export interface OpenAiTranscription {
  text: string;
  language?: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{ id: number; start: number; end: number; text: string }>;
}

export async function transcribeAudio(file: Blob, fileName: string): Promise<OpenAiTranscription> {
  const form = new FormData();
  form.append("file", file, fileName);
  form.append("model", config.openai.transcriptionModel);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  return withRetry(
    async () => {
      const res = await fetch(`${config.openai.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.openai.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        const msg = await readError(res);
        if (res.status === 401 || res.status === 403) throw new LlmUnavailableError(msg);
        throw new Error(`OpenAI transcription failed: ${msg}`);
      }
      return (await res.json()) as OpenAiTranscription;
    },
    { retries: 2, onRetry: (err, attempt) => log.warn(`transcription retry ${attempt}`, err) },
  );
}
