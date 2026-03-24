import { Id } from "../../../../convex/_generated/dataModel";

const ProjectIdPage = async ({
  params,
}: {
  params: Promise<{ projectId: Id<"projects">}>;
}) => {
  const { projectId } = await params;
  return <div>{projectId}</div>;
};
export default ProjectIdPage;
