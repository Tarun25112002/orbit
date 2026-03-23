"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import {
  Authenticated,
  AuthLoading,
  ConvexReactClient,
  Unauthenticated,
} from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

import { UnauthenticatedView } from "@/features/auth/components/unauthenticated-view";

import { ThemeProvider } from "./theme-provider";
import { Spinner } from "./ui/spinner";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export const Providers = ({ children }: { children: React.ReactNode }) => {
  return (
    <ClerkProvider>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <Authenticated>{children}</Authenticated>

          <Unauthenticated>
            <UnauthenticatedView />
          </Unauthenticated>

          <AuthLoading>
            <div className="flex min-h-screen items-center justify-center bg-background px-4">
              <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
                <Spinner className="size-4 text-ring" />
                <span className="text-sm text-muted-foreground">
                  Loading workspace...
                </span>
              </div>
            </div>
          </AuthLoading>
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
};
