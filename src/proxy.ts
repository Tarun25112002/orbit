import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const WEB_CONTAINER_COOP_VALUE = "same-origin";

const resolveCoepValue = (userAgent: string) => {
  // `credentialless` is not implemented uniformly outside Chromium.
  const supportsCredentialless =
    /\b(?:Chrome|Chromium|Edg|OPR|Opera)\//i.test(userAgent) &&
    !/\bFirefox\//i.test(userAgent);

  return supportsCredentialless ? "credentialless" : "require-corp";
};

const isProjectRoute = (pathname: string) =>
  pathname === "/projects" || pathname.startsWith("/projects/");

export default clerkMiddleware((_auth, request) => {
  const response = NextResponse.next();

  if (!isProjectRoute(request.nextUrl.pathname)) {
    return response;
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  response.headers.set("Cross-Origin-Opener-Policy", WEB_CONTAINER_COOP_VALUE);
  response.headers.set(
    "Cross-Origin-Embedder-Policy",
    resolveCoepValue(userAgent),
  );

  return response;
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
