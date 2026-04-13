import { ProjectIdLayout } from "@/features/projects/components/project-id-layout";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { notFound } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";

const Layout = async ({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) => {
  const { projectId } = await params;

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }

  const { getToken } = await auth();
  const convexToken = await getToken({ template: "convex" });
  if (!convexToken) {
    notFound();
  }

  const userConvex = new ConvexHttpClient(convexUrl);
  userConvex.setAuth(convexToken);

  try {
    const project = await userConvex.query(api.projects.getById, {
      id: projectId as Id<"projects">,
    });

    if (!project) {
      notFound();
    }
  } catch {
    notFound();
  }

  return (
    <ProjectIdLayout projectId={projectId as Id<"projects">}>
      {children}
    </ProjectIdLayout>
  );
};
export default Layout;
