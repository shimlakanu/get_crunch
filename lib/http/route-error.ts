export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export function jsonErrorBody(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/** Logs with `[tag]` prefix, returns JSON `{ error }` for route handlers. */
export function logRouteErrorResponse(err: unknown, tag: string, status = 500): Response {
  const message = getErrorMessage(err);
  console.error(`[${tag}] Error:`, message);
  return jsonErrorBody(message, status);
}
