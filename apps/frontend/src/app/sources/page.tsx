"use client";

import Link from "next/link";
import { palette, type } from "@/components/logos/tokens";
import { useLangState } from "@/components/logos/i18n";

export default function SourcesPage() {
  const { lang, s, setLang } = useLangState();
  const c = s.sources;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: palette.bg,
        color: palette.text,
        fontFamily: type.ui,
        padding: "0 24px 96px",
      }}
    >
      <header
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "28px 0 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: type.mono,
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: palette.muted,
        }}
      >
        <Link
          href="/"
          aria-label={c.back}
          style={{
            color: palette.muted,
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderRadius: 8,
            transition: "color 240ms ease, background 240ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = palette.text;
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = palette.muted;
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg width={14} height={10} viewBox="0 0 14 10" fill="none" aria-hidden>
            <path
              d="M5 1L1 5l4 4M1 5h12"
              stroke="currentColor"
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{c.back}</span>
        </Link>

        <div
          role="radiogroup"
          aria-label={s.top.langAria}
          style={{
            display: "inline-flex",
            border: `0.5px solid ${palette.hairline}`,
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          {(["ru", "en"] as const).map((v) => {
            const on = lang === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setLang(v)}
                style={{
                  appearance: "none",
                  border: 0,
                  cursor: "pointer",
                  background: on ? "rgba(255,255,255,0.06)" : "transparent",
                  color: on ? palette.text : palette.faint,
                  fontFamily: type.mono,
                  fontSize: 10,
                  letterSpacing: "0.22em",
                  textTransform: "uppercase",
                  padding: "8px 12px",
                }}
              >
                {v}
              </button>
            );
          })}
        </div>
      </header>

      <article
        style={{
          maxWidth: 720,
          margin: "0 auto",
          fontSize: 16.5,
          lineHeight: 1.7,
          color: palette.text,
        }}
      >
        <h1
          style={{
            fontFamily: type.logo,
            fontWeight: 300,
            fontSize: "clamp(40px, 6.4vw, 64px)",
            letterSpacing: "0.03em",
            margin: "32px 0 16px",
            color: palette.text,
          }}
        >
          {c.title}
        </h1>
        <p
          style={{
            color: palette.muted,
            margin: "0 0 48px",
            fontFamily: type.quote,
            fontStyle: "italic",
            fontSize: 18,
            lineHeight: 1.55,
          }}
        >
          {c.lede}
        </p>

        <Section heading={c.origin.heading}>
          {c.origin.paragraphs.map((p, i) => (
            <p key={i} style={paraStyle}>
              {renderWithAzbyka(p)}
            </p>
          ))}
        </Section>

        <Section heading={c.principles.heading}>
          <ul style={listStyle}>
            {c.principles.items.map((item, i) => (
              <li key={i} style={listItemStyle}>
                <span style={bulletStyle} aria-hidden>·</span>
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section heading={c.rights.heading}>
          {c.rights.paragraphs.map((p, i) => (
            <p key={i} style={paraStyle}>{p}</p>
          ))}
          <p style={{ ...paraStyle, marginTop: 18 }}>
            <span
              style={{
                fontFamily: type.mono,
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: palette.faint,
                marginRight: 12,
              }}
            >
              {c.rights.contactLabel}
            </span>
            <a
              href={`mailto:${c.rights.contactEmail}`}
              style={{
                color: palette.text,
                textDecoration: "underline",
                textDecorationColor: palette.hairline,
                textUnderlineOffset: 4,
              }}
            >
              {c.rights.contactEmail}
            </a>
          </p>
        </Section>

        <Section heading={c.legal.heading}>
          <p style={paraStyle}>{c.legal.intro}</p>
          <ul style={listStyle}>
            {c.legal.items.map((item, i) => (
              <li key={i} style={listItemStyle}>
                <span style={bulletStyle} aria-hidden>·</span>
                {item}
              </li>
            ))}
          </ul>
          <p style={{ ...paraStyle, color: palette.muted, marginTop: 14, fontSize: 15 }}>
            {c.legal.disclaimer}
          </p>
        </Section>

        <Section heading={c.gratitude.heading}>
          <p style={{ ...paraStyle, fontFamily: type.quote, fontSize: 17.5, fontStyle: "italic" }}>
            {c.gratitude.body}
          </p>
        </Section>

        <footer
          style={{
            marginTop: 72,
            paddingTop: 22,
            borderTop: `0.5px solid ${palette.hairline}`,
            color: palette.faint,
            fontFamily: type.mono,
            fontSize: 10.5,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          {c.colophon}
        </footer>
      </article>
    </main>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section style={{ margin: "0 0 40px" }}>
      <h2
        style={{
          fontFamily: type.logo,
          fontWeight: 400,
          fontSize: 24,
          letterSpacing: "0.02em",
          margin: "0 0 16px",
          color: palette.text,
          paddingTop: 28,
          borderTop: `0.5px solid ${palette.hairline}`,
        }}
      >
        {heading}
      </h2>
      {children}
    </section>
  );
}

const paraStyle: React.CSSProperties = {
  margin: "0 0 14px",
  color: palette.text,
};

const listStyle: React.CSSProperties = {
  margin: "0 0 14px",
  paddingLeft: 0,
  listStyle: "none",
};

const listItemStyle: React.CSSProperties = {
  margin: "0 0 12px",
  color: palette.text,
  paddingLeft: 22,
  position: "relative",
};

const bulletStyle: React.CSSProperties = {
  position: "absolute",
  left: 6,
  top: 0,
  color: palette.faint,
  fontFamily: type.mono,
};

// Render a paragraph turning standalone `azbyka.ru` mentions into an
// external link. Keeps i18n strings free of HTML while still giving the
// user something clickable to the source we're crediting.
function renderWithAzbyka(text: string): React.ReactNode {
  const parts = text.split(/(azbyka\.ru)/g);
  return parts.map((part, i) =>
    part === "azbyka.ru" ? (
      <a
        key={i}
        href="https://azbyka.ru"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: palette.text,
          textDecoration: "underline",
          textDecorationColor: palette.hairline,
          textUnderlineOffset: 4,
        }}
      >
        azbyka.ru
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
