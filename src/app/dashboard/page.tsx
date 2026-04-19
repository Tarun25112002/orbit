import { Suspense } from "react";
import { ProjectsView } from "@/features/projects/components/projects-view";
import { GitHubErrorHandler } from "@/features/projects/components/github-error-handler";

const Dashboard = () => {
  return (
    <>
      <Suspense fallback={null}>
        <GitHubErrorHandler />
      </Suspense>
      <ProjectsView />
    </>
  );
};

export default Dashboard;
