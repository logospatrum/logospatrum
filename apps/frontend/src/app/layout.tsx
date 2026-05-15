import type { Metadata } from "next";
import "./globals.css";
import { Inter } from "next/font/google";
import React from "react";
import { NuqsAdapter } from "nuqs/adapters/next/app";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  preload: true,
  display: "swap",
});

export const metadata: Metadata = {
  title: "Патристический помощник",
  description:
    "Поиск и беседа по святоотеческой литературе, философии и Писанию с точными цитатами и ссылками на оригинал.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={inter.className}>
        <NuqsAdapter>{children}</NuqsAdapter>
      </body>
    </html>
  );
}
