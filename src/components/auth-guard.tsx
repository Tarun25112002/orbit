"use client";

import { useAuth } from "@clerk/nextjs";
import { Authenticated, AuthLoading, Unauthenticated } from "convex/react";
import { UnauthenticatedView } from "@/features/auth/components/unauthenticated-view";
import { Spinner } from "@/components/ui/spinner";

export const AuthGuard = ({ children }: { children: React.ReactNode }) => {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
          <Spinner className="size-4 text-ring" />
          <span className="text-sm text-muted-foreground">
            Loading...
          </span>
        </div>
      </div>
    );
  }

  if (isSignedIn) {
    return (
      <>
        <AuthLoading>
          <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
              <Spinner className="size-4 text-ring" />
              <span className="text-sm text-muted-foreground">
                Connecting workspace...
              </span>
            </div>
          </div>
        </AuthLoading>
        <Authenticated>{children}</Authenticated>
        <Unauthenticated>
          <UnauthenticatedView />
        </Unauthenticated>
      </>
    );
  }

  return <UnauthenticatedView />;
};
