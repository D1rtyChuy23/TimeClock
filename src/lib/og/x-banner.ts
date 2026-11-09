import { createIsomorphicFn } from "@tanstack/react-start";
import { xBannerFromRequest } from "@/lib/og/x-banner.server";
import { publicShareHost } from "@/lib/og/share-host";

/** Absolute X feed card, or "" when there is no public host (same guard as og:image). */
export const xBannerUrl = createIsomorphicFn()
  .server(xBannerFromRequest)
  .client(() => {
    const fromEnv = publicShareHost(
      (import.meta.env as { VITE_PUBLIC_HOSTNAME?: string }).VITE_PUBLIC_HOSTNAME,
    );
    const fromWindow =
      typeof window !== "undefined" ? publicShareHost(window.location.host) : "";
    const host = fromEnv || fromWindow;
    return host ? `https://${host}/x-banner.jpg` : "";
  });
