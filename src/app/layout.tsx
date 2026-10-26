import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/toast";
import { APP_NAME } from "@/lib/app-name";
import { env } from "@/server/env";
import { inter } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(env.APP_URL),
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
};

export const viewport: Viewport = {
  viewportFit: "cover", // env(safe-area-inset-*) under bottom bars
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" }, // design-ok: Next metadata can't read CSS variables
    { media: "(prefers-color-scheme: dark)", color: "#000000" }, // design-ok: Next metadata can't read CSS variables
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.variable}>
      {/* Below lg, a page with a TabBar or the license page's PriceBar keeps its last content clear of the fixed bar,
          whose height globals.css sets as --bar-offset (04 §9.4, §9.30). A word too long for its line (an email, a
          handle, a name with no spaces) breaks instead of pushing the page sideways (07 D153); it changes no box's
          size, so normal text looks the same. */}
      <body className="wrap-break-word max-lg:has-[[data-tabbar],[data-pricebar]]:pb-[calc(var(--bar-offset)+env(safe-area-inset-bottom))]">
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
