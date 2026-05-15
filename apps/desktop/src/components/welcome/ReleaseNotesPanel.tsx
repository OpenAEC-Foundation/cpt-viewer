import { useEffect, useState } from "react";
import "./ReleaseNotesPanel.css";

interface Release {
  tag_name: string;
  name: string;
  body: string;
  published_at: string;
  html_url: string;
}

const REPO = "OpenAEC-Foundation/OpenAEC-style-book";
const CACHE_KEY = "openaec-releases-cache-v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// Bundled fallback for offline / API-blocked situations.
const FALLBACK_RELEASES: Release[] = [
  {
    tag_name: "v0.1.0",
    name: "Initial OpenAEC desktop template",
    body: "Ribbon UI, multi-tenant report generation, IFC viewer, 3D viewer, recent files, MCP server, multi-window with drag-out tabs.",
    published_at: "2026-05-12T00:00:00Z",
    html_url: "https://github.com/OpenAEC-Foundation/OpenAEC-style-book/releases",
  },
];

export function ReleaseNotesPanel() {
  const [releases, setReleases] = useState<Release[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let aborted = false;
    (async () => {
      // Try cache first
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
          const { data, ts } = JSON.parse(cached);
          if (Date.now() - ts < CACHE_TTL_MS && Array.isArray(data)) {
            setReleases(data);
          }
        }
      } catch {
        /* ignore parse errors */
      }

      // Fetch fresh
      try {
        const resp = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`);
        if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);
        const data: Release[] = await resp.json();
        if (aborted) return;
        setReleases(data);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn("[ReleaseNotes] GitHub fetch failed, using bundled fallback:", msg);
        if (!aborted) {
          setReleases((prev) => (prev && prev.length > 0 ? prev : FALLBACK_RELEASES));
          setError(null);
        }
      }
    })();
    return () => {
      aborted = true;
    };
  }, []);

  return (
    <aside className="welcome-side-panel">
      <div className="welcome-brand">
        <h3>OpenAEC</h3>
        <a
          href="https://www.open-aec.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="welcome-link"
        >
          www.open-aec.com →
        </a>
      </div>

      <div className="welcome-releases">
        <h3>Wat is er nieuw</h3>
        {error && !releases && (
          <p className="welcome-error">Kan release notes niet laden ({error})</p>
        )}
        {!releases && !error && <p className="welcome-loading">Laden…</p>}
        {releases?.length === 0 && <p>Geen releases gevonden</p>}
        {releases?.map((r) => (
          <article key={r.tag_name} className="welcome-release">
            <header>
              <a
                href={r.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="welcome-release-tag"
              >
                {r.tag_name}
              </a>
              <time className="welcome-release-date">
                {new Date(r.published_at).toLocaleDateString("nl-NL", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </header>
            <h4 className="welcome-release-title">{r.name || r.tag_name}</h4>
            <div className="welcome-release-body">{truncate(r.body, 320)}</div>
          </article>
        ))}
      </div>
    </aside>
  );
}

function truncate(s: string, n: number): string {
  if (!s) return "";
  const cleaned = s.replace(/^#+\s+/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length > n ? cleaned.slice(0, n).trim() + "…" : cleaned;
}
