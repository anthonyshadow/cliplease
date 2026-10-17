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
      <body>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
