import Link from "next/link";

export default function ProjectNotFoundPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-16">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-foreground">
          Project Not Found
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This project may have been deleted, or you may no longer have access
          to it.
        </p>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Back To Dashboard
          </Link>
        </div>
      </div>
    </main>
  );
}
