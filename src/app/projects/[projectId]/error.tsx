"use client";

import Link from "next/link";

const isProjectMissingError = (message: string) => {
  return (
    /project not found/i.test(message) ||
    /unauthorized access to this project/i.test(message) ||
    /unauthorized to access this project/i.test(message) ||
    /\[CONVEX Q\(projects:getById\)\]/i.test(message)
  );
};

export default function ProjectRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const message = error?.message ?? "Unknown error";
  const showNotFoundStyle = isProjectMissingError(message);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">
          {showNotFoundStyle ? "Project Not Found" : "Project Failed To Load"}
        </h1>

        <p className="mt-3 text-sm text-muted-foreground">
          {showNotFoundStyle
            ? "This project may have been deleted, or you may no longer have access to it."
            : "Something went wrong while loading this project."}
        </p>

        <div className="mt-6 flex items-center justify-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground  hover:opacity-90"
          >
            Back To Dashboard
          </Link>

          {!showNotFoundStyle ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground  hover:bg-accent"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
