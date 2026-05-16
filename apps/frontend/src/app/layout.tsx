import type { Metadata } from "next";
import "./globals.css";
import {
  Cormorant_Garamond,
  EB_Garamond,
  Geist_Mono,
  Inter,
} from "next/font/google";
import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";

// The ΛΟΓΟΣ typography pairing. Cormorant + EB Garamond for the sacred
// surfaces (logo, scripture, quoted excerpts), Inter for chrome, Geist Mono
// for the colophon-style uppercase labels. CSS variables let the inline
// styles in `components/logos/tokens.ts` reference them without `Font(...)`
// imports in every component.
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  preload: true,
  display: "swap",
  variable: "--font-inter",
});
const cormorant = Cormorant_Garamond({
  subsets: ["latin", "cyrillic"],
  weight: ["300", "400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-cormorant",
});
const ebGaramond = EB_Garamond({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-eb-garamond",
});
const geistMono = Geist_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "ΛΟΓΟΣ — Theological Research Assistant",
  description:
    "Поиск и беседа по святоотеческой литературе, философии и Писанию с точными цитатами и ссылками на оригинал.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${inter.variable} ${cormorant.variable} ${ebGaramond.variable} ${geistMono.variable}`}
    >
      <body className={inter.className}>
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
