---
name: testing-k-versation
description: Recorded local-first K-VERSATION browser testing with keyless script alignment and media artifact validation.
---

# K-VERSATION runtime testing

## Setup
- Work from the repository root. Check for an existing localhost:3000 server before starting `npm run dev`.
- Dependencies and FFmpeg/FFprobe must be available; verify rather than reinstalling unnecessarily.
- For deterministic keyless coverage, launch with `OPENAI_API_KEY=""`, upload a known-duration WAV, and paste a script with distinct concrete subjects.
- No application login or Wikimedia API key is required.
- Use a new named test project; hash existing `data/projects/*.json` before testing and verify afterward to avoid silently altering saved user work.
- Prefer a separate writable `K_VERSATION_DATA_DIR` for destructive/failure-path tests. Verify the server actually uses that directory before editing fixtures or project JSON.

## UI workflow
- Use the native chooser. In GTK's chooser, focus the location field with Ctrl+L before entering an absolute fixture path; confirm the chooser is still foreground.
- One Generate action creates the project and generates its timeline.
- Save timestamp edits by blurring the number input. Verify count/coverage after Remove and Restore.
- Choosing an image can invalidate an existing render even if the original selection is restored; isolate edits in a new project.
- Inspect alternatives, source metadata, transcript expansion, export progress wording, and reload/reopen persistence.
- For mobile testing, use Chrome's visible responsive toolbar at 390×844; verify chooser and saved-project selector without initial scrolling and hero availability below the form.

## Download validation
- Trigger downloads through the UI and inspect the resulting files in `~/Downloads`.
- Check TXT/SRT against supplied script. Downloaded timeline JSON has `chosenImage` plus `alternatives`, not the full persisted project schema; verify duration, sources, active visuals, and edited timings there. Check `transcriptSource: "script-alignment"` in the stored project instead.
- Run FFprobe on the downloaded MP4 to verify H.264/AAC, 1920×1080, and expected duration; also play it visibly in the browser.
- Record GUI activity and annotate meaningful assertions; command-only validation belongs in textual evidence.

## Reversible hardening checks
- Only with authorization and isolated data, back up the completed project JSON and hash its completed MP4 before injecting an invalid selected remote image/thumbnail URL. Trigger rerender through the UI; verify inline failure, absence of MP4 link/output path, rejection of the old download URL, and unchanged completed-file hash. Restore the JSON and rerender successfully before finishing.
- For asset ownership checks, use a real supported PNG inside the isolated project's uploads directory that no candidate references. Navigate to its `/api/assets?path=...` URL; expect rejection while referenced manual images still load.

## Devin Secrets Needed
- None for pasted-script alignment and Wikimedia.
- `OPENAI_API_KEY` is needed only when explicitly testing the OpenAI transcription path.
