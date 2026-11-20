/// <reference types="vite/client" />
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import type * as React from "react";
import nunitoLatin from "@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url";
import appCss from "~/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      // Keep iOS Safari from underlining emails (family members, invitations) as links.
      { name: "format-detection", content: "email=no" },
      { title: "Lifestory" },
    ],
    links: [
      // The browser otherwise finds the UI font only after parsing the stylesheet and laying out text, so the first
      // paint used a fallback font (font-display: swap) and then swapped to Nunito.
      { rel: "preload", href: nunitoLatin, as: "font", type: "font/woff2", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: appCss },
      // From apps/web/public. The .ico (16, 32, 48 px) is for browsers without SVG favicons; sizes="32x32" keeps
      // Chrome from preferring it over the SVG.
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  component: () => <Outlet />,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
