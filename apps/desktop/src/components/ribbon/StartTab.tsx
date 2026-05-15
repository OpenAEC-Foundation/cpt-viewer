import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { useCptStore, loadCptFromContent } from "../../store/useCptStore";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

// Inline simple SVG icons (lucide-style, single-stroke).
const uploadIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline stroke-linecap="round" stroke-linejoin="round" stroke-width="2" points="17 8 12 3 7 8"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="12" y1="3" x2="12" y2="15"/></svg>`;
const zoomInIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" stroke-width="2"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="21" y1="21" x2="16.65" y2="16.65"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="11" y1="8" x2="11" y2="14"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" y1="11" x2="14" y2="11"/></svg>`;
const zoomOutIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" stroke-width="2"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="21" y1="21" x2="16.65" y2="16.65"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="8" y1="11" x2="14" y2="11"/></svg>`;
const zoomFitIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/></svg>`;
const closeIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="18" y1="6" x2="6" y2="18"/><line stroke-linecap="round" stroke-linejoin="round" stroke-width="2" x1="6" y1="6" x2="18" y2="18"/></svg>`;

export default function StartTab() {
  const { t } = useTranslation("ribbon");
  const closeAll = useCptStore((s) => s.closeAll);

  async function handleOpen() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "CPT", extensions: ["gef", "GEF", "xml", "XML"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    for (const p of paths) {
      try {
        const content = await readTextFile(p);
        const filename = p.split(/[\\/]/).pop() ?? p;
        await loadCptFromContent(content, filename);
      } catch (e) {
        console.error("open_cpt failed for", p, e);
      }
    }
  }

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("file")}>
          <RibbonButton icon={uploadIcon} label={t("open")} size="large" onClick={handleOpen} />
        </RibbonGroup>
        <RibbonGroup label={t("zoom")}>
          <RibbonButton icon={zoomInIcon} label={t("zoomIn")} size="large" onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-in"))} />
          <RibbonButton icon={zoomOutIcon} label={t("zoomOut")} size="large" onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-out"))} />
          <RibbonButton icon={zoomFitIcon} label={t("zoomFit")} size="large" onClick={() => window.dispatchEvent(new CustomEvent("ogs:zoom-fit"))} />
        </RibbonGroup>
        <RibbonGroup label={t("edit")}>
          <RibbonButton icon={closeIcon} label={t("closeAll")} size="large" onClick={() => void closeAll()} />
        </RibbonGroup>
      </div>
    </div>
  );
}
