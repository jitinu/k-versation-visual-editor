# K-VERSATION Visual Editor

Personal-use web app that turns a narration recording into a sparse, editable visual timeline and renders a 16:9 1080p MP4.

**Flow:** upload audio (+ optional script) → transcribe & align → LLM picks a *small* set of moments worth a visual → image search (authoritative sources first) → cheap prefilter → optional vision re-rank → editable timeline → background FFmpeg render → export MP4 / transcript / SRT / timeline JSON. Projects are saved locally and can be reopened.

## Requirements

- Node 20+
- `ffmpeg` and `ffprobe` on `PATH` (or set `FFMPEG_PATH` / `FFPROBE_PATH`)
- **Free/local AI (default, no API keys):** Python 3.9+ with `faster-whisper` for word-timestamped transcription, and [Ollama](https://ollama.com) for moment selection, titles and vision ranking. See *Free local setup* below.
- Image search needs no keys: Wikimedia Commons + Openverse (CC-licensed) + DuckDuckGo Images are on by default.
- Optional paid alternative: `OPENAI_API_KEY` (switches transcription/LLM/vision to OpenAI).
- If the local tools are missing the app still runs in labelled **mock mode** (evenly spaced timing, heuristic moment picking) and the home page shows a warning banner saying what to install.

## Setup

```bash
npm install
cp .env.example .env.local   # then edit
npm run dev                  # http://localhost:3000
```

Other scripts: `npm run build`, `npm start`, `npm run lint`, `npm run typecheck`, `npm test`.

### Free local setup (recommended)

```bash
# 1. Transcription with real word timestamps (CPU is fine: ~6 s per 45 s of audio with the `small` model)
pip install faster-whisper            # model downloads to ~/.cache on first run

# 2. Local LLM for moment picking / title / vision ranking
#    macOS: brew install ollama   (or download from https://ollama.com)
ollama serve &
ollama pull llama3.1                  # text model (~4.7 GB)
ollama pull llava                     # vision model for image ranking (~4.7 GB)
```

With nothing in `.env.local` the defaults are `TRANSCRIPTION_PROVIDER=local`, `LLM_PROVIDER=ollama`, `IMAGE_SEARCH_PROVIDERS=wikimedia,openverse,duckduckgo`, `VISION_RANKING_ENABLED=true`. Tunables: `LOCAL_WHISPER_MODEL` (`tiny|base|small|medium|large-v3`; `medium` is noticeably better for Korean names), `LOCAL_WHISPER_DEVICE=cuda` if you have an NVIDIA GPU, `OLLAMA_MODEL`, `OLLAMA_VISION_MODEL`, `OLLAMA_BASE_URL`, `PYTHON_PATH`.

When you paste a script, it is aligned word-by-word to the audio timestamps, so the timeline uses your exact wording at the real spoken times.

### Providers / API keys

| Purpose | Env var | Notes |
| --- | --- | --- |
| Transcription | `TRANSCRIPTION_PROVIDER` | `local` (faster-whisper, default) · `openai` (`OPENAI_API_KEY`) · `whisperx` (`WHISPERX_URL`, self-hosted service returning `word_segments`) · `mock` |
| Story analysis, title, vision ranking | `LLM_PROVIDER` | `ollama` (default, keyless) · `openai` (`OPENAI_API_KEY`, default when the key is set) · `mock` |
| Image search | `IMAGE_SEARCH_PROVIDERS` | Comma list, all queried in parallel and pooled (authoritative sources sorted first): `wikimedia`, `openverse`, `duckduckgo` (no keys) · `google` (`GOOGLE_CSE_API_KEY` + `GOOGLE_CSE_CX`, free 100 queries/day) · `serpapi` (`SERPAPI_API_KEY`) · `bing` (`BING_IMAGE_SEARCH_KEY`) · `mock`. DuckDuckGo uses an unofficial endpoint and drops stock-photo/social domains up front. |

All provider calls are retried (`SEARCH_RETRIES`) with timeouts and never log key values.

## Test with one sample file

1. `npm run dev` and open http://localhost:3000.
2. Drop an `.mp3/.wav/.m4a/.mp4/.mov` on the drop zone (or click it to open the OS file picker).
3. Optionally paste the script — it is aligned word-by-word to the real audio so timestamps stay accurate while wording comes from the script.
4. Leave the title blank; it is auto-generated after transcription (editable afterwards).
5. Pick a visual frequency (Minimal is the default and intentionally sparse), click **Generate Visual Timeline** and watch the stages (uploading → transcribing → analyzing → searching → selecting).
6. Review each moment: replace from alternatives, re-search with your own query, upload your own image, adjust start/end, remove, or regenerate. Global controls: regenerate all / low-confidence only, change frequency and rerun analysis, re-render.
7. **Export Video** starts a background render job (status polled every second). Download the MP4, transcript, SRT, or timeline JSON.
8. Return to the home page later — the project list reopens saved projects.

Check `GET /api/config` (or the banner on the home page) to see which providers are active and whether Ollama / faster-whisper were detected.

No sample audio? Generate one: `ffmpeg -f lavfi -i "sine=frequency=440:duration=60" -ac 1 sample.mp3` and paste any paragraph as the script (mock mode uses the script for content).

## Architecture

```
src/app/                 Next.js App Router pages + API routes
src/components/          Upload form, project editor, timeline cards
src/lib/config.ts        All env configuration (single place)
src/lib/jobs.ts          In-process background jobs, persisted to data/jobs/*.json
src/lib/storage/         Project JSON store + path-confined file helpers
src/lib/pipeline/
  transcribe.ts          openai | whisperx | mock transcription with word timestamps
  align.ts               Script ↔ ASR word-level alignment (DP, fuzzy)
  title.ts               Auto title generation
  prompts.ts + examples.json   Editorial system prompt + few-shot K-VERSATION style
  analyze.ts             Structured JSON moments (zod) + sparsity enforcement
  search.ts              Wikimedia / Openverse / DuckDuckGo / SerpAPI / Bing / Google CSE providers, authority scoring
  images.ts              Download, dimensions, dedup (dHash), watermark heuristic
  rank.ts                Optional vision ranking; skips moment if nothing fits
  timeline.ts            Timeline entries, hold 4–10s, overlap trimming
  render.ts              FFmpeg filter graph (fades, Ken Burns, optional subtitles)
  reference-ingest.ts    Documented stub for future reference-video ingestion
```

### Data

Everything lives under `K_VERSATION_DATA_DIR` (default `./data`):

```
data/projects/<id>/project.json     title, generatedTitle, script, transcript, alignedTranscript,
                                    moments, timeline (candidates + chosen), renderStatus, outputPath, timestamps
data/projects/<id>/{media,images,uploads,renders}/
data/jobs/<jobId>.json              job stage/progress/message
```

Paths are validated so reads/writes never leave a project directory. The app never deletes media; removing a timeline entry only hides it (restorable).

### Rendering

`POST /api/projects/:id/render` enqueues a job and returns immediately; `GET /api/jobs/:jobId` and `GET /api/projects/:id/render` report progress. FFmpeg runs as a child process with `-progress`. Output: 1920x1080 H.264 + AAC 192k, black background between visuals, 0.5 s fades, optional Ken Burns per entry, optional burned subtitles (off by default).

### Cloud storage

`STORAGE_BACKEND=s3` and `S3_*` vars are read by `config.ts` as the extension point; V1 implements local storage only.

## Future improvements

- Implement the S3/Supabase storage backend behind `STORAGE_BACKEND`.
- Ingest the channel's non-interview reference videos (see `reference-ingest.ts`) to refine editorial few-shots.
- Use a durable queue (BullMQ/Redis) instead of in-process jobs for multi-instance deployments.
- Waveform scrubber and live preview in the timeline editor.
- Perceptual watermark/logo detection model instead of heuristics.
- Reverse image search for provenance verification.
