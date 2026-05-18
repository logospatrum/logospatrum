import type { Metadata } from "next";
import "./globals.css";
import {
  Cormorant_Garamond,
  EB_Garamond,
  Geist_Mono,
  Inter,
} from "next/font/google";
import React from "react";
import Script from "next/script";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { cookies } from "next/headers";
import crypto from "node:crypto";

// Yandex Metrika counter ID. Inlined by `next build` from
// NEXT_PUBLIC_YM_COUNTER_ID — empty/unset means the counter never loads,
// which is the desired dev default.
const YM_COUNTER_ID = process.env.NEXT_PUBLIC_YM_COUNTER_ID ?? "";

/**
 * Compute the daily HMAC session token. Symmetric with
 * `apps/backend/src/backend/budget/session.py:sign` — same secret, same
 * `cookie:<uuid>:<UTC_date>` input, same `base64url` encoding without padding.
 * Embedded into <meta name="pat-session"> and sent back as X-Pat-Session.
 */
function signSession(patUid: string, secret: string): string {
  if (!secret || !patUid) return "";
  const date = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  return crypto
    .createHmac("sha256", secret)
    .update(`cookie:${patUid}:${date}`)
    .digest("base64url"); // Node 16+ emits unpadded base64url
}

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Cookie is issued by middleware.ts on first visit. We compute the HMAC
  // token here (Node runtime) because node:crypto.createHmac isn't available
  // in middleware's Edge runtime.
  const patUid = (await cookies()).get("pat_uid")?.value ?? "";
  const patSession = signSession(patUid, process.env.PAT_SESSION_SECRET ?? "");

  return (
    <html
      lang="ru"
      className={`${inter.variable} ${cormorant.variable} ${ebGaramond.variable} ${geistMono.variable}`}
    >
      <head>
        <meta name="pat-session" content={patSession} />
      </head>
      <body className={inter.className}>
        <NuqsAdapter>{children}</NuqsAdapter>
        {YM_COUNTER_ID && (
          <>
            <Script id="ym-counter" strategy="afterInteractive">
              {`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js?id=${YM_COUNTER_ID}","ym");ym(${YM_COUNTER_ID},"init",{ssr:true,clickmap:true,referrer:document.referrer,url:location.href,accurateTrackBounce:true,trackLinks:true});`}
            </Script>
            <noscript>
              <div>
                <img
                  src={`https://mc.yandex.ru/watch/${YM_COUNTER_ID}`}
                  style={{ position: "absolute", left: "-9999px" }}
                  alt=""
                />
              </div>
            </noscript>
          </>
        )}
      </body>
    </html>
  );
}
