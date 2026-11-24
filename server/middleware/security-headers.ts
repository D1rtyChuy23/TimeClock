/**
 * Standard protection headers on every response from the deployed app.
 *
 * - nosniff: browsers never guess a file is a script.
 * - Referrer-Policy: links out (maps, email) never carry an invitation or
 *   password-reset token from this page's address.
 * - Permissions-Policy: only this app itself may ask for location (clock-in
 *   rules); camera, microphone and payment are off.
 *
 * Framing is not restricted here on purpose: the Grok hosting preview shows the
 * app inside a frame. Add `frame-ancestors` once that is no longer needed.
 */
const HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
};

export default async function securityHeaders(_event: unknown, next: () => unknown | Promise<unknown>): Promise<unknown> {
  const result = await next();
  if (!(result instanceof Response)) return result;
  try {
    for (const [k, v] of Object.entries(HEADERS)) if (!result.headers.has(k)) result.headers.set(k, v);
    return result;
  } catch {
    // Some responses have locked headers: copy them into a new response.
    const headers = new Headers(result.headers);
    for (const [k, v] of Object.entries(HEADERS)) if (!headers.has(k)) headers.set(k, v);
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  }
}
