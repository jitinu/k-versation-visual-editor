import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { json } from "@/lib/api";
import { config, describeProviders } from "@/lib/config";

export const runtime = "nodejs";

const run = promisify(execFile);

async function ollamaReachable(): Promise<boolean | null> {
  if (config.llm.provider !== "ollama") return null;
  try {
    const res = await fetch(`${config.llm.baseUrl}/models`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function localWhisperReady(): Promise<boolean | null> {
  if (config.transcription.provider !== "local") return null;
  try {
    await run(config.transcription.pythonPath, ["-c", "import faster_whisper"], { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

/** Non-secret summary of which providers are active + whether local tools are reachable (for UI badges). */
export async function GET() {
  const [ollama, whisper] = await Promise.all([ollamaReachable(), localWhisperReady()]);
  const warnings: string[] = [];
  if (ollama === false)
    warnings.push(
      `Ollama not reachable at ${config.llm.baseUrl} – moment selection / title / vision ranking will fall back to heuristics. Run \`ollama serve\` and \`ollama pull ${config.llm.textModel}\`.`,
    );
  if (whisper === false)
    warnings.push(
      "faster-whisper not found – transcription will fall back to evenly spaced mock timing. Run `pip install faster-whisper`.",
    );
  return json({ ...describeProviders(), ollamaReachable: ollama, localWhisperReady: whisper, warnings });
}
