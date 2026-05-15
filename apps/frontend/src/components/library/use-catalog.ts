"use client";
import { useEffect, useState } from "react";

const CACHE_KEY = "patristic:catalog";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h

export interface CatalogWork {
  slug: string;
  title: string;
  creation_date: string | null;
  section: string | null;
  source_url: string | null;
  topics: string[] | null;
  paragraph_count: number;
}

export interface CatalogAuthor {
  slug: string;
  name: string;
  years: string | null;
  century: number | null;
  global_section: string | null;
  works: CatalogWork[];
}

export interface Catalog {
  authors: CatalogAuthor[];
}

function load(): Catalog | null {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { timestamp: number; data: Catalog };
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function save(data: Catalog): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), data }),
    );
  } catch {
    /* quota — best effort */
  }
}

export function useCatalog() {
  const [data, setData] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = load();
    if (cached) {
      setData(cached);
      return;
    }
    // Catalog FastAPI is mounted into langgraph dev via langgraph.json
    // ("http": { "app": "backend.catalog:app" }), so it lives on the same
    // port as the agent API. Fall back through the same env vars as
    // StreamProvider, defaulting to langgraph dev's 2024.
    const url =
      process.env.NEXT_PUBLIC_CATALOG_API_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_LANGGRAPH_API_URL ||
      "http://localhost:2024";
    setLoading(true);
    fetch(`${url}/catalog`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json: Catalog) => {
        save(json);
        setData(json);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
      .finally(() => setLoading(false));
  }, []);

  return { data, loading, error };
}
