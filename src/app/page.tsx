import { NewProjectForm } from "@/components/NewProjectForm";
import { ProjectList } from "@/components/ProjectList";

export default function HomePage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Drop in your audio files and their images. Each pair becomes a 1080p MP4 with the image held for the full narration, all rendered at once.
        </p>
        <div className="mt-6">
          <NewProjectForm />
        </div>
      </section>
      <aside>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">Saved projects</h2>
        <div className="mt-3">
          <ProjectList />
        </div>
      </aside>
    </div>
  );
}
