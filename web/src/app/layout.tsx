import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";

import { themeScript } from "@/design/theme";
import { timeZoneScript } from "@/features/study";

import "@/styles/globals.css";

// src/styles/fonts links to app/assets/fonts, so the app and the web share one copy.
const pretendard = localFont({
  src: [
    { path: "../styles/fonts/Pretendard-Regular.otf", weight: "400" },
    { path: "../styles/fonts/Pretendard-Medium.otf", weight: "500" },
    { path: "../styles/fonts/Pretendard-SemiBold.otf", weight: "600" },
    { path: "../styles/fonts/Pretendard-Bold.otf", weight: "700" },
    { path: "../styles/fonts/Pretendard-ExtraBold.otf", weight: "800" },
  ],
  variable: "--font-pretendard",
  display: "swap",
});

// One face, declared at the weight its styles ask for, so a character it lacks falls back to
// Pretendard ExtraBold.
const jua = localFont({
  src: "../styles/fonts/Jua-Regular.ttf",
  weight: "800",
  variable: "--font-jua",
  display: "swap",
});

export const metadata: Metadata = {
  title: "알아몰라",
  description: "카드로 외우는 암기 앱",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF3FF" },
    { media: "(prefers-color-scheme: dark)", color: "#111A2E" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The script sets data-theme on <html> before React hydrates it.
    <html
      lang="ko"
      className={`${pretendard.variable} ${jua.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: timeZoneScript }} />
      </head>
      <body className="bg-ground font-sans text-ink">{children}</body>
    </html>
  );
}
