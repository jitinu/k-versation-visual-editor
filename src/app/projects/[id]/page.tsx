import { ProjectEditor } from "@/components/ProjectEditor";

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ job?: string }>;
}) {
  const { id } = await params;
  const { job } = await searchParams;
  return <ProjectEditor projectId={id} initialJobId={job} />;
}
