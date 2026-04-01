const sanitizeConvexErrorMessage = (message: string) => {
  const flattened = message.replace(/\s+/g, " ").trim();
  if (!flattened) {
    return "";
  }

  const withoutEnvelope = flattened
    .replace(/^\[CONVEX [^\]]+\]\s*/i, "")
    .replace(/^\[Request ID:[^\]]+\]\s*/i, "")
    .replace(/^Server Error\s*/i, "")
    .trim();

  const uncaughtMatch = withoutEnvelope.match(
    /Uncaught (?:Error|ConvexError):\s*(.+?)(?=\s+at\s+\S+\s*\(|\s+Called by client|$)/i,
  );
  if (uncaughtMatch?.[1]) {
    return uncaughtMatch[1].trim();
  }

  const serverMatch = withoutEnvelope.match(
    /Error:\s*(.+?)(?=\s+at\s+\S+\s*\(|\s+Called by client|$)/i,
  );
  if (serverMatch?.[1]) {
    return serverMatch[1].trim();
  }

  return withoutEnvelope.replace(/\s+Called by client$/i, "").trim();
};

export const getErrorMessage = (
  error: unknown,
  fallback = "Something went wrong.",
) => {
  if (error instanceof Error && error.message) {
    const normalized = sanitizeConvexErrorMessage(error.message);
    return normalized || fallback;
  }

  if (typeof error === "string") {
    const normalized = sanitizeConvexErrorMessage(error);
    return normalized || fallback;
  }

  return fallback;
};
