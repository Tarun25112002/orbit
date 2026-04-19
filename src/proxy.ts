import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isProjectRoute = (pathname: string) =>
  pathname === "/projects" || pathname.startsWith("/projects/");

/** Routes accessible without Clerk sign-in */
const isPublicRoute = (pathname: string) =>
  pathname === "/" ||
  pathname.startsWith("/sign-in") ||
  pathname.startsWith("/sign-up") ||
  pathname.startsWith("/pricing") ||
  pathname.startsWith("/api/auth/github") || // GitHub OAuth callback needs access
  pathname.startsWith("/api/webhooks") || // Stripe webhooks - must be public
  pathname.startsWith("/api/inngest") ||
  pathname.startsWith("/monitoring");

/**
 * Next.js 16 proxy (middleware).
 *
 * 1. Protects all routes except public ones — unauthenticated users only see landing page
 * 2. Clears stale GitHub cookies on sign-out
 * 3. Sets COOP/COEP headers for WebContainer project routes
 */
export default clerkMiddleware(async (_auth, request) => {
  const pathname = request.nextUrl.pathname;

  // ─── Route protection ─────────────────────────────────────────────
  // Check for Clerk session cookies to determine authentication.
  // We check cookies directly because auth.protect() can fail in
  // Next.js 16 proxy.ts setups where the auth context doesn't propagate.
  const hasSession =
    request.cookies.has("__session") || request.cookies.has("__clerk_db_jwt");

  if (!isPublicRoute(pathname) && !hasSession) {
    const signInUrl = new URL("/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  const response = NextResponse.next();

  // ─── Clear stale GitHub cookies when no active Clerk session ─────────
  const hasGitHubToken = request.cookies.has("github_token");

  if (hasGitHubToken && !hasSession) {
    response.cookies.set("github_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    response.cookies.set("github_token_owner", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    response.cookies.set("github_oauth_state", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  // ─── WebContainer COOP/COEP headers for project routes ─────────────
  if (isProjectRoute(pathname)) {
    const ua = request.headers.get("user-agent") ?? "";
    const isChromium =
      /\b(?:Chrome|Chromium|Edg|OPR|Opera)\//i.test(ua) &&
      !/\bFirefox\//i.test(ua);

    response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
    response.headers.set(
      "Cross-Origin-Embedder-Policy",
      isChromium ? "credentialless" : "require-corp",
    );
  }

  return response;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
