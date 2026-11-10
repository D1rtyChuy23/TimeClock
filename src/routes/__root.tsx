import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { APPEARANCE_BOOT_SCRIPT } from "@/lib/appearance";
import { LanguageProvider } from "@/lib/i18n";
import { xBannerUrl } from "@/lib/og/x-banner";
import appCss from "../styles.css?url";

const APP_NAME = "Time Clock";

export const Route = createRootRoute({
  head: () => {
    const xBanner = xBannerUrl();
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title: APP_NAME },
        { name: "theme-color", content: "#0b2545" },
        ...(xBanner ? [{ property: "x:game:image", content: xBanner }] : []),
      ],
      links: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Barlow:ital,wght@0,400;0,500;0,600;1,400&display=swap",
        },
        { rel: "stylesheet", href: appCss },
        { rel: "manifest", href: "/__grok/manifest.webmanifest" },
        { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      ],
    };
  },
  component: () => (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Display settings (src/lib/appearance.ts) before first paint, so a saved scheme never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <LanguageProvider>
          <AuthProvider>
            <Outlet />
            <Toaster position="bottom-center" />
          </AuthProvider>
        </LanguageProvider>
        <Scripts />
      </body>
    </html>
  ),
});
