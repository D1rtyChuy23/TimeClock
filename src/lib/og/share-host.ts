/** Hostnames that can serve /og.jpg and /x-banner.jpg. Local and Vercel system hosts cannot. */
export function publicShareHost(raw: string | undefined): string {
  const host = String(raw ?? "")
    .split(",")[0]
    ?.trim()
    .split(":")[0]
    ?.toLowerCase() ?? "";
  if (!host || !/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return "";
  if (
    host === "vercel.app" ||
    host.endsWith(".vercel.app") ||
    host === "vercel.com" ||
    host.endsWith(".vercel.com")
  ) {
    return "";
  }
  return host;
}
