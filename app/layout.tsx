import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import { OfflineBadge } from "@/components/offline-badge";
import { SiteFooter } from "@/components/misc";
import { AccessibilityDock } from "@/components/a11y-widget";
import { BackToTop } from "@/components/back-to-top";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "SuperTET Prep - Bilingual Practice Tests",
    template: "%s · SuperTET Prep",
  },
  description:
    "Free bilingual (Hindi + English) SuperTET practice tests, flashcards and progress tracking. Works offline.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2f6df6" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1628" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} flex min-h-full flex-col antialiased`}
      >
        <Providers>
          <SiteHeader />
          <OfflineBadge />
          <main className="flex-1">{children}</main>
          <SiteFooter />
          {/* Floating helpers, stacked in one column: back-to-top shows up
              while scrolling, the accessibility dock stays until dismissed.
              z-40 keeps both under dialogs and the toaster (z-50), and the
              data attribute lets the print stylesheet drop the whole column. */}
          <div
            data-floating-tools
            className="fixed right-4 bottom-4 z-40 flex flex-col items-end gap-2"
          >
            <BackToTop />
            <AccessibilityDock />
          </div>
        </Providers>
      </body>
    </html>
  );
}

