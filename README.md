# K-VERSATION

K-VERSATION is a local-first visual editor for narrated stories. Upload a finished narration, optionally provide the script, generate a sparse visual timeline, review the chosen images, and export a 1080p MP4.

## What V1 includes

- MP3, WAV, M4A, MP4, and MOV uploads
- Optional pasted or uploaded script
- Timestamped OpenAI transcription
- Script-to-recording alignment
- Minimal, balanced, and frequent visual modes
- Structured LLM story analysis with a local fallback
- Wikimedia Commons image search, metadata, ranking, and alternatives
- Editable visual start/end times
- Replace, remove, restore, search again, and upload-your-own-image controls
- Persistent local projects
- FFmpeg 16:9 1080p export with neutral gaps and clean fades
- Transcript, SRT, and timeline JSON downloads

## Requirements

- Node.js 20.9 or newer
- npm
- FFmpeg and FFprobe available on `PATH`
- An OpenAI API key for real transcription and LLM analysis

The app remains runnable without an API key:

- If a script is supplied, it is distributed across the real media duration as a local alignment fallback.
- If no script is supplied, a clearly marked demo transcript is generated so the review and export workflow can still be exercised.
- Wikimedia Commons search does not require a key.

## Setup

```bash
npm install
cp .env.example .env.local
```

Add your key to `.env.local`:

```dotenv
OPENAI_API_KEY=your_key_here
```

The defaults use:

- `whisper-1` for timestamped transcription
- `gpt-4.1-mini` for sparse visual-moment analysis
- Wikimedia Commons for image retrieval

All provider names and paths can be changed in `.env.local`.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

For a production build:

```bash
npm run build
npm start
```

## Test with one sample file

1. Open **New project**.
2. Drop in an MP3, WAV, M4A, MP4, or MOV.
3. Paste the narration script if no OpenAI key is configured.
4. Leave **Visual frequency** on **Minimal**.
5. Create the project, then click **Generate visual timeline**.
6. Review the selected moments, alternatives, timing, and sources.
7. Click **Export video**.
8. Download the MP4, transcript, SRT, or timeline JSON.
9. Reload the app and reopen the project from the sidebar.

## Data and privacy

By default, all project files live under `./data`:

```text
data/
  projects/   Project metadata
  uploads/    Narration and manually uploaded images
  cache/      Images fetched for rendering
  renders/    MP4 and metadata exports
```

Set `K_VERSATION_DATA_DIR` to move this workspace. Server-side path validation prevents assets from resolving outside the configured directory. The app includes no analytics, tracking, accounts, or public-sharing features.

Do not commit `.env.local` or the `data` directory.

## Scripts

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run start
npm run check
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | Recommended | Real transcription and LLM content analysis |
| `OPENAI_BASE_URL` | No | OpenAI-compatible API base URL |
| `OPENAI_TRANSCRIPTION_MODEL` | No | Transcription model; defaults to `whisper-1` |
| `OPENAI_ANALYSIS_MODEL` | No | Analysis model; defaults to `gpt-4.1-mini` |
| `K_VERSATION_DATA_DIR` | No | Project and render storage |
| `MAX_UPLOAD_MB` | No | Maximum narration upload size |
| `FFMPEG_PATH` | No | FFmpeg executable |
| `FFPROBE_PATH` | No | FFprobe executable |

## Architecture

- Next.js App Router and TypeScript
- React client workspace
- Node.js route handlers
- Atomic JSON project persistence
- OpenAI-compatible REST integration
- Wikimedia Commons API
- FFmpeg rendering

External integrations are isolated under `src/lib`, so transcription, analysis, image search, storage, or rendering providers can be replaced without changing the UI.

## V1 tradeoffs and future improvements

- Generation and rendering requests are synchronous. A background job queue is the next step for hosted deployments.
- Local JSON persistence is intentionally simple. Supabase/Postgres and object storage can replace it for cloud deployment.
- Wikimedia Commons is the default search source. Museum, archive, government, and commercial image APIs can be added as provider adapters.
- Ranking currently combines editorial priority, title relevance, resolution, duplicate filtering, and source quality. A dedicated multimodal reranker can be added behind the same pipeline.
- Vertical 9:16 export and burned-in subtitle toggles are natural follow-ups.
