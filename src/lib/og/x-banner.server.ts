import { getRequest } from "@tanstack/react-start/server";
import { publicShareHost } from "@/lib/og/share-host";

export function xBannerFromRequest(): string {
  const envHost = (import.meta.env as { VITE_PUBLIC_HOSTNAME?: string }).VITE_PUBLIC_HOSTNAME;
  let header = "";
  try {
    const req = getRequest();
    header = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  } catch {
    header = "";
  }
  const host = publicShareHost(envHost) || publicShareHost(header);
  return host ? `https://${host}/x-banner.jpg` : "";
}
