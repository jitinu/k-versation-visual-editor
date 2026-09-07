"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Project,
  ProjectSummary,
  VisualFrequency,
  VisualMoment,
} from "@/lib/types";
import { formatTimestamp } from "@/lib/utils";

type IconName =
  | "arrow"
  | "clock"
  | "download"
  | "file"
  | "image"
  | "play"
  | "plus"
  | "refresh"
  | "search"
  | "sparkles"
  | "trash"
  | "upload"
  | "wave";

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <><path d="M5 12h14M14 7l5 5-5 5" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    download: <><path d="M12 3v12M7 10l5 5 5-5" /><path d="M5 20h14" /></>,
    file: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    refresh: <><path d="M20 7v5h-5" /><path d="M18.5 16a8 8 0 1 1 .7-7" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m16.5 16.5 4 4" /></>,
    sparkles: <><path d="m12 3 1.3 3.7L17 8l-3.7 1.3L12 13l-1.3-3.7L7 8l3.7-1.3z" /><path d="m6 14 .8 2.2L9 17l-2.2.8L6 20l-.8-2.2L3 17l2.2-.8zM18 14l.6 1.4L20 16l-1.4.6L18 18l-.6-1.4L16 16l1.4-.6z" /></>,
    trash: <><path d="M5 7h14M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v5h16v-5" /></>,
    wave: <><path d="M3 12h2l1.5-5 3 10 3-13 3 16 2.5-8H21" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...common}>
      {paths[name]}
    </svg>
  );
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return body;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.78) return "Strong match";
  if (confidence >= 0.58) return "Good match";
  return "Review suggested";
}

const stages = [
  "Transcribing narration",
  "Analyzing the story",
  "Selecting key moments",
  "Searching image archives",
  "Ranking visual matches",
];

export function KVersationApp() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [project, setProject] = useState<Project>();
  const [showNewProject, setShowNewProject] = useState(true);
  const [busy, setBusy] = useState(false);
  const [generationStage, setGenerationStage] = useState(0);
  const [error, setError] = useState("");
  const [alternativesFor, setAlternativesFor] = useState<string>();
  const [searchTerms, setSearchTerms] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [media, setMedia] = useState<File>();
  const mediaInput = useRef<HTMLInputElement>(null);

  const refreshProjects = useCallback(async () => {
    setProjects(await requestJson<ProjectSummary[]>("/api/projects"));
  }, []);

  useEffect(() => {
    let active = true;
    requestJson<ProjectSummary[]>("/api/projects")
      .then((loadedProjects) => {
        if (active) setProjects(loadedProjects);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load projects",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(
      () => setGenerationStage((current) => Math.min(current + 1, stages.length - 1)),
      2200,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  const activeVisuals = useMemo(
    () => project?.visuals.filter((visual) => !visual.removed) ?? [],
    [project],
  );

  async function openProject(id: string) {
    setError("");
    setBusy(true);
    try {
      setProject(await requestJson<Project>(`/api/projects/${id}`));
      setShowNewProject(false);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Could not open project");
    } finally {
      setBusy(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!media) {
      setError("Choose an audio or video recording first.");
      return;
    }
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    form.set("media", media);
    try {
      const created = await requestJson<Project>("/api/projects", {
        method: "POST",
        body: form,
      });
      setProject(created);
      setShowNewProject(false);
      await refreshProjects();
      setGenerationStage(0);
      const generated = await requestJson<Project>(
        `/api/projects/${created.id}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lowConfidenceOnly: false }),
        },
      );
      setProject(generated);
      await refreshProjects();
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : "Could not create the visual timeline",
      );
    } finally {
      setBusy(false);
    }
  }

  async function generate(lowConfidenceOnly = false) {
    if (!project) return;
    setError("");
    setBusy(true);
    setGenerationStage(0);
    try {
      const generated = await requestJson<Project>(
        `/api/projects/${project.id}/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lowConfidenceOnly }),
        },
      );
      setProject(generated);
      await refreshProjects();
    } catch (generationError) {
      setError(
        generationError instanceof Error ? generationError.message : "Generation failed",
      );
      await openProject(project.id);
    } finally {
      setBusy(false);
    }
  }

  async function patchProject(update: Partial<Project>) {
    if (!project) return;
    const optimistic = { ...project, ...update };
    setProject(optimistic);
    try {
      setProject(
        await requestJson<Project>(`/api/projects/${project.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        }),
      );
      await refreshProjects();
    } catch (patchError) {
      setProject(project);
      setError(patchError instanceof Error ? patchError.message : "Could not save changes");
    }
  }

  async function patchMoment(momentId: string, update: Record<string, unknown>) {
    if (!project) return;
    setError("");
    try {
      setProject(
        await requestJson<Project>(
          `/api/projects/${project.id}/moments/${momentId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(update),
          },
        ),
      );
      await refreshProjects();
    } catch (patchError) {
      setError(patchError instanceof Error ? patchError.message : "Timeline update failed");
    }
  }

  async function regenerateMoment(moment: VisualMoment) {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      setProject(
        await requestJson<Project>(
          `/api/projects/${project.id}/moments/${moment.id}/regenerate`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: searchTerms[moment.id] }),
          },
        ),
      );
      setAlternativesFor(moment.id);
    } catch (regenerationError) {
      setError(
        regenerationError instanceof Error
          ? regenerationError.message
          : "Image search failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadReplacement(momentId: string, file?: File) {
    if (!project || !file) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("image", file);
    try {
      setProject(
        await requestJson<Project>(
          `/api/projects/${project.id}/moments/${momentId}`,
          { method: "POST", body: form },
        ),
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Image upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function renderVideo() {
    if (!project) return;
    setBusy(true);
    setError("");
    try {
      const rendered = await requestJson<Project>(
        `/api/projects/${project.id}/render`,
        { method: "POST" },
      );
      setProject(rendered);
      await refreshProjects();
    } catch (renderError) {
      const message =
        renderError instanceof Error ? renderError.message : "Rendering failed";
      setProject(
        await requestJson<Project>(`/api/projects/${project.id}`).catch(
          () => project,
        ),
      );
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  function selectMedia(file?: File) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["mp3", "wav", "m4a", "mp4", "mov"].includes(extension)) {
      setError("Supported formats: mp3, wav, m4a, mp4, mov.");
      return;
    }
    setMedia(file);
    setError("");
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => { setProject(undefined); setShowNewProject(true); }}>
          <span className="brand-mark"><Icon name="wave" size={20} /></span>
          <span>K-VERSATION</span>
        </button>
        <button className="new-project-button" type="button" onClick={() => { setProject(undefined); setMedia(undefined); setShowNewProject(true); setError(""); }}>
          <Icon name="plus" size={17} /> New project
        </button>
        <div className="sidebar-section">
          <div className="sidebar-label"><span>Recent projects</span><span>{projects.length}</span></div>
          <div className="project-list">
            {projects.map((entry) => (
              <button className={`project-link ${project?.id === entry.id ? "active" : ""}`} key={entry.id} type="button" onClick={() => openProject(entry.id)}>
                <span className="project-link-icon"><Icon name="file" size={16} /></span>
                <span className="project-link-copy">
                  <strong>{entry.title}</strong>
                  <small>{formatDate(entry.updatedAt)} · {entry.visualCount} visuals</small>
                </span>
              </button>
            ))}
            {projects.length === 0 && <p className="empty-sidebar">Your saved projects will appear here.</p>}
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="privacy-dot" />
          <div><strong>Local workspace</strong><span>Private by default</span></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Visual storytelling workspace</span>
            <h1>{showNewProject ? "Create a new story" : project?.title ?? "Opening project"}</h1>
          </div>
          {project && !showNewProject && (
            <div className="topbar-actions">
              <span className={`status-chip status-${project.status}`}><span /> {project.statusMessage}</span>
              <button className="icon-button" type="button" onClick={refreshProjects} aria-label="Refresh"><Icon name="refresh" /></button>
            </div>
          )}
        </header>

        {error && (
          <div className="error-banner">
            <strong>Something needs attention.</strong><span>{error}</span>
            <button type="button" onClick={() => setError("")}>Dismiss</button>
          </div>
        )}

        {busy && (
          <div className="progress-overlay">
            <div className="progress-card">
              <span className="progress-orbit"><Icon name="sparkles" size={26} /></span>
              <span className="eyebrow">K-VERSATION is working</span>
              <h2>{project?.status === "rendering" ? "Rendering your finished video" : stages[generationStage]}</h2>
              <p>{project?.status === "rendering" ? "Compositing imagery, fades, and original narration at 1080p." : "Sparse visual selection takes a little care. Keep this window open."}</p>
              <div className="progress-track"><span style={{ width: `${project?.status === "rendering" ? 72 : 16 + generationStage * 19}%` }} /></div>
            </div>
          </div>
        )}

        {showNewProject ? (
          <NewProjectForm media={media} dragging={dragging} mediaInput={mediaInput} onSubmit={createProject} onMedia={selectMedia} onDragging={setDragging} />
        ) : project ? (
          <ProjectWorkspace
            project={project}
            activeVisuals={activeVisuals}
            alternativesFor={alternativesFor}
            searchTerms={searchTerms}
            onGenerate={generate}
            onPatchProject={patchProject}
            onPatchMoment={patchMoment}
            onAlternatives={setAlternativesFor}
            onSearchTerms={setSearchTerms}
            onRegenerateMoment={regenerateMoment}
            onUploadReplacement={uploadReplacement}
            onRender={renderVideo}
          />
        ) : <div className="center-message">Opening project…</div>}
      </section>
    </main>
  );
}

interface NewProjectFormProps {
  media?: File;
  dragging: boolean;
  mediaInput: React.RefObject<HTMLInputElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onMedia: (file?: File) => void;
  onDragging: (value: boolean) => void;
}

function NewProjectForm({ media, dragging, mediaInput, onSubmit, onMedia, onDragging }: NewProjectFormProps) {
  return (
    <form className="new-project-grid" onSubmit={onSubmit}>
      <section className="hero-card">
        <div className="hero-copy">
          <span className="eyebrow">Narration to visual story</span>
          <h2>Show less.<br />Say more.</h2>
          <p>Upload your narration. K-VERSATION finds the few images that make the most important moments land.</p>
          <div className="principle-row"><span><b>01</b> Intentional</span><span><b>02</b> Specific</span><span><b>03</b> Editable</span></div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <span className="art-line line-one" /><span className="art-line line-two" /><span className="art-line line-three" />
          <span className="art-sun" /><span className="art-caption">moments, not wallpaper</span>
        </div>
      </section>

      <section className="form-card">
        <div className="section-heading"><div><span className="step-number">1</span><div><h3>Add your narration</h3><p>Audio is required. Everything else is optional.</p></div></div></div>
        <input ref={mediaInput} type="file" name="media" accept=".mp3,.wav,.m4a,.mp4,.mov" hidden onChange={(event) => onMedia(event.target.files?.[0])} />
        <button
          type="button"
          className={`drop-zone ${dragging ? "dragging" : ""} ${media ? "has-file" : ""}`}
          onClick={() => mediaInput.current?.click()}
          onDragOver={(event) => { event.preventDefault(); onDragging(true); }}
          onDragLeave={() => onDragging(false)}
          onDrop={(event) => { event.preventDefault(); onDragging(false); onMedia(event.dataTransfer.files?.[0]); }}
        >
          <span className="upload-icon"><Icon name={media ? "wave" : "upload"} size={25} /></span>
          {media ? <><strong>{media.name}</strong><span>{(media.size / 1024 / 1024).toFixed(1)} MB · Click to replace</span></> : <><strong>Drop your recording here</strong><span>or click to browse · MP3, WAV, M4A, MP4, MOV</span></>}
        </button>

        <div className="two-column-fields">
          <label><span>Project title</span><input name="title" placeholder="e.g. The road to Apollo 11" /></label>
          <label><span>Visual frequency</span><select name="visualFrequency" defaultValue="minimal"><option value="minimal">Minimal — a few strong images</option><option value="balanced">Balanced — moderate coverage</option><option value="frequent">Frequent — more visual beats</option></select></label>
        </div>

        <details className="script-panel">
          <summary><span><Icon name="file" size={17} /> Add an optional script</span><small>Better wording alignment</small></summary>
          <div className="script-fields">
            <textarea name="script" rows={6} placeholder="Paste the final narration script here…" />
            <label className="script-upload"><Icon name="upload" size={16} /><span>Or upload a .txt or .md file</span><input type="file" name="scriptFile" accept=".txt,.md,text/plain,text/markdown" /></label>
          </div>
        </details>

        <button className="primary-button generate-button" type="submit">Generate visual timeline <Icon name="arrow" /></button>
        <p className="form-footnote">Files stay inside your configured K-VERSATION data directory.</p>
      </section>
    </form>
  );
}

interface ProjectWorkspaceProps {
  project: Project;
  activeVisuals: VisualMoment[];
  alternativesFor?: string;
  searchTerms: Record<string, string>;
  onGenerate: (lowConfidenceOnly?: boolean) => void;
  onPatchProject: (update: Partial<Project>) => void;
  onPatchMoment: (momentId: string, update: Record<string, unknown>) => void;
  onAlternatives: (momentId?: string) => void;
  onSearchTerms: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onRegenerateMoment: (moment: VisualMoment) => void;
  onUploadReplacement: (momentId: string, file?: File) => void;
  onRender: () => void;
}

function ProjectWorkspace({
  project,
  activeVisuals,
  alternativesFor,
  searchTerms,
  onGenerate,
  onPatchProject,
  onPatchMoment,
  onAlternatives,
  onSearchTerms,
  onRegenerateMoment,
  onUploadReplacement,
  onRender,
}: ProjectWorkspaceProps) {
  const hasTimeline = project.transcript.length > 0;
  return (
    <div className="project-workspace">
      <section className="project-summary">
        <div className="audio-panel">
          <div className="audio-icon"><Icon name="wave" size={22} /></div>
          <div className="audio-copy"><strong>{project.mediaOriginalName}</strong><span>{project.duration ? formatTimestamp(project.duration) : "Duration detected during generation"} · Original audio preserved</span></div>
          <audio controls preload="metadata" src={`/api/assets?path=${encodeURIComponent(project.mediaPath)}`} />
        </div>
        <div className="summary-controls">
          <label><span>Visual frequency</span><select value={project.visualFrequency} onChange={(event) => onPatchProject({ visualFrequency: event.target.value as VisualFrequency })}><option value="minimal">Minimal</option><option value="balanced">Balanced</option><option value="frequent">Frequent</option></select></label>
          <button className="primary-button" type="button" onClick={() => onGenerate(false)}><Icon name="sparkles" /> {hasTimeline ? "Regenerate all" : "Generate visual timeline"}</button>
        </div>
      </section>

      {!hasTimeline ? (
        <section className="generation-empty">
          <div className="empty-visual"><Icon name="sparkles" size={34} /><span /><span /><span /></div>
          <span className="eyebrow">Ready for analysis</span>
          <h2>Find the moments worth seeing.</h2>
          <p>K-VERSATION will transcribe this recording, identify a sparse set of meaningful visual beats, and search authoritative image sources.</p>
          <button className="primary-button large-button" type="button" onClick={() => onGenerate(false)}>Generate visual timeline <Icon name="arrow" /></button>
          <small className="fallback-note">Without an API key, pasted scripts use local alignment and recordings use clearly marked demo transcription.</small>
        </section>
      ) : (
        <>
          <section className="metrics-row">
            <div><span>Selected visuals</span><strong>{activeVisuals.length}</strong><small>Sparse by design</small></div>
            <div><span>Visual coverage</span><strong>{Math.round((activeVisuals.reduce((total, visual) => total + visual.endTime - visual.startTime, 0) / project.duration) * 100) || 0}%</strong><small>of total runtime</small></div>
            <div><span>Transcript</span><strong>{project.transcript.length}</strong><small>{project.transcriptSource === "demo" ? "demo segments" : "timed segments"}</small></div>
            <div><span>Review status</span><strong>{activeVisuals.filter((visual) => visual.confidence >= 0.58).length}/{activeVisuals.length}</strong><small>good or strong matches</small></div>
          </section>

          {project.transcriptSource === "demo" && <div className="demo-banner"><Icon name="sparkles" /><span><strong>Demo transcription is active.</strong> Add OPENAI_API_KEY or provide a script for meaningful spoken-content analysis.</span></div>}

          <section className="timeline-section">
            <div className="section-title-row">
              <div><span className="eyebrow">Visual timeline</span><h2>Moments selected for emphasis</h2><p>Nothing appears between these moments. That space is intentional.</p></div>
              <button className="secondary-button" type="button" onClick={() => onGenerate(true)}><Icon name="refresh" /> Regenerate low confidence</button>
            </div>
            <div className="timeline-list">
              {project.visuals.map((moment, index) => {
                const chosen = moment.candidates.find((image) => image.id === moment.chosenImageId);
                return (
                  <article className={`moment-card ${moment.removed ? "removed" : ""}`} key={moment.id}>
                    <div className="moment-rail"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
                    <div className="moment-image">
                      {chosen ? <img src={chosen.thumbnailUrl || chosen.imageUrl} alt={chosen.title} /> : <div className="no-image"><Icon name="image" size={30} /><span>No strong image found</span></div>}
                      {!moment.removed && <span className={`confidence ${moment.confidence < 0.58 ? "low" : ""}`}>{confidenceLabel(moment.confidence)}</span>}
                    </div>
                    <div className="moment-content">
                      <div className="moment-time">
                        <Icon name="clock" size={15} />
                        <label><input type="number" step="0.1" min="0" max={project.duration} defaultValue={moment.startTime.toFixed(1)} onBlur={(event) => onPatchMoment(moment.id, { startTime: Number(event.target.value) })} />s</label>
                        <span>—</span>
                        <label><input type="number" step="0.1" min="0" max={project.duration} defaultValue={moment.endTime.toFixed(1)} onBlur={(event) => onPatchMoment(moment.id, { endTime: Number(event.target.value) })} />s</label>
                        <span className="visual-type">{moment.suggestedVisualType}</span>
                      </div>
                      <blockquote>“{moment.transcriptExcerpt}”</blockquote>
                      <p>{moment.whyVisualIsHelpful}</p>
                      {chosen && <div className="source-line"><span>{chosen.title}</span><a href={chosen.sourceUrl || undefined} target="_blank" rel="noreferrer">{chosen.sourceName}{chosen.license ? ` · ${chosen.license}` : ""}</a></div>}
                      <div className="moment-actions">
                        <button type="button" onClick={() => onAlternatives(alternativesFor === moment.id ? undefined : moment.id)}><Icon name="image" size={15} /> {alternativesFor === moment.id ? "Hide alternatives" : `See alternatives (${Math.max(0, moment.candidates.length - 1)})`}</button>
                        <label className="action-upload"><Icon name="upload" size={15} /> Upload image<input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={(event) => onUploadReplacement(moment.id, event.target.files?.[0])} /></label>
                        <button type="button" onClick={() => onPatchMoment(moment.id, { removed: !moment.removed })}><Icon name={moment.removed ? "plus" : "trash"} size={15} /> {moment.removed ? "Restore" : "Remove"}</button>
                      </div>
                      {alternativesFor === moment.id && (
                        <div className="alternatives-panel">
                          <div className="manual-search"><Icon name="search" size={16} /><input value={searchTerms[moment.id] ?? ""} onChange={(event) => onSearchTerms((current) => ({ ...current, [moment.id]: event.target.value }))} placeholder="Search again with a more specific phrase" /><button type="button" onClick={() => onRegenerateMoment(moment)}>Search</button></div>
                          <div className="alternative-grid">
                            {moment.candidates.map((image) => (
                              <button className={image.id === moment.chosenImageId ? "selected" : ""} type="button" key={image.id} onClick={() => onPatchMoment(moment.id, { chosenImageId: image.id, removed: false })}>
                                <img src={image.thumbnailUrl || image.imageUrl} alt={image.title} /><span>{image.title}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="transcript-section">
            <details>
              <summary><span><Icon name="file" /> Transcript <b>{project.transcript.length} segments</b></span><span>Open transcript</span></summary>
              <div className="transcript-list">{project.transcript.map((segment) => <div key={segment.id}><time>{formatTimestamp(segment.start)}</time><p>{segment.text}</p></div>)}</div>
            </details>
          </section>

          <section className="export-panel">
            <div><span className="eyebrow">Final output</span><h2>Ready to make the cut?</h2><p>Render a 1080p MP4 with your original narration, selected images, neutral gaps, and clean fades.</p></div>
            <div className="export-actions">
              <button className="primary-button large-button" type="button" onClick={onRender}><Icon name="play" /> {project.outputVideoPath ? "Re-render video" : "Export video"}</button>
              {project.outputVideoPath && <a className="download-video" href={`/api/projects/${project.id}/download/video`}><Icon name="download" /> Download MP4</a>}
            </div>
            {project.status === "error" && project.error && (
              <div className="export-error">
                <strong>Export did not finish.</strong>
                <span>{project.error}</span>
              </div>
            )}
            <div className="download-row">
              <a href={`/api/projects/${project.id}/download/transcript`}><Icon name="download" size={15} /> Transcript</a>
              <a href={`/api/projects/${project.id}/download/srt`}><Icon name="download" size={15} /> SRT captions</a>
              <a href={`/api/projects/${project.id}/download/timeline`}><Icon name="download" size={15} /> Timeline JSON</a>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
