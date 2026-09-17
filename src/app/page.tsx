import { NewProjectForm } from "@/components/NewProjectForm";
import { ProjectList } from "@/components/ProjectList";

export default function HomePage() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Upload narration audio and one image to create an MP4 with that image held for the full narration.
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
