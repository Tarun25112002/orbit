"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

export function GitHubErrorHandler() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const errorType = searchParams.get("github_error");
    const connected = searchParams.get("github_connected");
    const alreadyConnected = searchParams.get("github_already_connected");

    if (!errorType && !connected && !alreadyConnected) return;

    if (errorType) {
      if (errorType === "access_denied") {
        toast.info("GitHub connection cancelled.");
      } else if (errorType === "user_mismatch") {
        toast.error("GitHub session mismatch. Please try connecting again.");
      } else if (errorType === "token_exchange_failed") {
        toast.error("Failed to connect GitHub. Please try again.");
      } else if (errorType === "server_error") {
        toast.error("Something went wrong connecting to GitHub. Please try again.");
      } else {
        toast.error("GitHub connection failed. Please try again.");
      }
    } else if (connected) {
      toast.success("Successfully connected to GitHub!");
    } else if (alreadyConnected) {
      toast.info("GitHub is already connected.");
    }

    const url = new URL(window.location.href);
    url.searchParams.delete("github_error");
    url.searchParams.delete("github_connected");
    url.searchParams.delete("github_already_connected");
    window.history.replaceState({}, "", url.toString());
  }, [searchParams]);

  return null;
}
