import { useCptStore } from "../store/useCptStore";
import "./DocumentBar.css";

interface DocumentBarProps {
  /** Optional handler for the "+" button — wired by App.tsx to open Backstage. */
  onOpenClick?: () => void;
}

export default function DocumentBar({ onOpenClick }: DocumentBarProps) {
  const documents = useCptStore((s) => s.documents);
  const activeDocId = useCptStore((s) => s.activeDocId);
  const setActiveDoc = useCptStore((s) => s.setActiveDoc);
  const closeDoc = useCptStore((s) => s.closeDoc);

  return (
    <div className="document-bar">
      <div className="document-tabs">
        {documents.map((doc) => {
          const active = doc.id === activeDocId;
          return (
            <button
              key={doc.id}
              type="button"
              className={`document-tab${active ? " active" : ""}`}
              onClick={() => setActiveDoc(doc.id)}
              title={doc.path ?? doc.title}
            >
              <span className="document-tab-icon">
                {doc.kind === "project" ? <FolderIcon /> : <FileIcon />}
              </span>
              <span className="document-tab-title">{doc.title}</span>
              <span
                className="document-tab-close"
                role="button"
                tabIndex={-1}
                aria-label="Sluiten"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeDoc(doc.id);
                }}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
                </svg>
              </span>
            </button>
          );
        })}
        {onOpenClick && (
          <button
            type="button"
            className="document-tab document-tab-add"
            onClick={onOpenClick}
            title="Openen"
            aria-label="Openen"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

function FileIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}
