import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = (pathname: string) =>
  pathname === "/" ||
  pathname.startsWith("/sign-in") ||
  pathname.startsWith("/sign-up") ||
  pathname.startsWith("/pricing") ||
  pathname.startsWith("/api/auth/github") ||
  pathname === "/api/stripe/create-checkout" ||
  pathname === "/api/stripe/sync-session" ||
  pathname.startsWith("/api/webhooks") ||
  pathname.startsWith("/api/stripe/webhooks") ||
  pathname.startsWith("/api/inngest") ||
  pathname.startsWith("/monitoring");

export default clerkMiddleware(async (_auth, request) => {
  const pathname = request.nextUrl.pathname;

  const hasSession =
    request.cookies.has("__session") || request.cookies.has("__clerk_db_jwt");

  if (!isPublicRoute(pathname) && !hasSession) {
    const signInUrl = new URL("/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  const response = NextResponse.next();

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

  return response;
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
