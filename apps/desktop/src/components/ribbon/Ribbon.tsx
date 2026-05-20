import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import RibbonTab from "./RibbonTab";
import StartTab from "./StartTab";
import KaartTab from "./KaartTab";
import IfcTab from "./IfcTab";
import RapportTab from "./RapportTab";
import SonderingstekeningTab from "./SonderingstekeningTab";
import { useExtension } from "../../hooks/useExtensions";
import "./Ribbon.css";

interface RibbonProps {
  onFileTabClick?: () => void;
  onSettingsClick?: () => void;
  onProjectSettingsClick?: () => void;
  activeView: string;
  onViewChange: (view: string) => void;
}

// Tab order (left → right): Home (project + chart) → Kaart (location) →
// Rapport → Sonderingstekening (tekening) → IFC (model, always last).
// IFC is auto-generated and rarely the active workflow target, so it
// sits at the end where it can't get in the way.
//
// Rapport en Tekening zijn EXTENSIES (default UIT) — gebruiker schakelt
// ze aan via Instellingen → Extensies. Wanneer uit, vallen ze uit de
// tab-rij en ben je dus alleen Start / Kaart / IFC kwijt aan ribbon-
// ruimte. ALL_TABS is de complete lijst; visibleTabs hieronder filtert
// op de live extension-state.
const ALL_TABS = ["start", "kaart", "rapport", "tekening", "ifc"] as const;
type TabId = (typeof ALL_TABS)[number];

export default function Ribbon({ onFileTabClick, onProjectSettingsClick, onViewChange }: RibbonProps) {
  const { t, i18n } = useTranslation("ribbon");
  const [activeTab, setActiveTab] = useState<TabId>("start");
  const extRapport = useExtension("rapport");
  const extTekening = useExtension("tekening");

  const TABS = useMemo<readonly TabId[]>(() => {
    return ALL_TABS.filter((t) => {
      if (t === "rapport") return extRapport;
      if (t === "tekening") return extTekening;
      return true;
    });
  }, [extRapport, extTekening]);

  // Als de huidig actieve tab door een extension-toggle uit de
  // zichtbare lijst valt, schakel naar Start (default-tab).
  useEffect(() => {
    if (!TABS.includes(activeTab)) {
      setActiveTab("start");
      onViewChange("default");
    }
  }, [TABS, activeTab, onViewChange]);

  // Allow other parts of the app (e.g. MapView's "Open in viewer" popup)
  // to programmatically jump to a specific ribbon tab. Listeners on
  // `ogs:ribbon-switch` with `detail.tab` matching a TabId.
  useEffect(() => {
    const onSwitch = (e: Event) => {
      const ce = e as CustomEvent<{ tab: TabId }>;
      const next = ce.detail?.tab;
      if (next && (ALL_TABS as readonly string[]).includes(next)) {
        switchTabRef.current?.(next);
      }
    };
    window.addEventListener("ogs:ribbon-switch", onSwitch as EventListener);
    return () => window.removeEventListener("ogs:ribbon-switch", onSwitch as EventListener);
  }, []);
  const [prevTab, setPrevTab] = useState<TabId | null>(null);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<"left" | "right">("right");
  const tabsRef = useRef<HTMLDivElement>(null);
  const borderRef = useRef<HTMLDivElement>(null);
  const gapRef = useRef<HTMLDivElement>(null);
  // Mirror of the latest switchTab callback so the once-bound
  // `ogs:ribbon-switch` listener always calls the up-to-date version.
  const switchTabRef = useRef<((tab: TabId) => void) | null>(null);

  const updateHighlight = useCallback(() => {
    const tabsEl = tabsRef.current;
    const borderEl = borderRef.current;
    const gapEl = gapRef.current;
    if (!tabsEl || !borderEl || !gapEl) return;

    const activeEl = tabsEl.querySelector(".ribbon-tab.active") as HTMLElement | null;
    if (!activeEl) {
      borderEl.style.opacity = "0";
      gapEl.style.opacity = "0";
      return;
    }

    const tabsRect = tabsEl.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const left = activeRect.left - tabsRect.left;
    const top = activeRect.top - tabsRect.top;
    const width = activeRect.width;
    const height = activeRect.height;

    borderEl.style.opacity = "1";
    borderEl.style.left = `${left}px`;
    borderEl.style.top = `${top}px`;
    borderEl.style.width = `${width}px`;
    borderEl.style.height = `${height}px`;

    gapEl.style.opacity = "1";
    gapEl.style.left = `${left + 1}px`;
    gapEl.style.width = `${width - 2}px`;
  }, []);

  const switchTab = useCallback((newTab: TabId) => {
    if (newTab === activeTab) return;
    // Gebruik ALL_TABS voor directie-bepaling: posities zijn vast,
    // ook al is de tab momenteel verborgen door een uitgeschakelde
    // extensie. Voorkomt -1 indexOf wanneer een tab pas net is
    // aangezet en switchTab gelijk wordt aangeroepen.
    const oldIndex = ALL_TABS.indexOf(activeTab);
    const newIndex = ALL_TABS.indexOf(newTab);
    setDirection(newIndex > oldIndex ? "right" : "left");
    setPrevTab(activeTab);
    setActiveTab(newTab);
    setAnimating(true);

    // Switch main content view based on tab.
    if (newTab === "rapport") onViewChange("report");
    else if (newTab === "kaart") onViewChange("map");
    else if (newTab === "ifc") onViewChange("ifc");
    else if (newTab === "tekening") onViewChange("tekening");
    else onViewChange("default");
  }, [activeTab, onViewChange]);

  // Keep the ref pointing at the latest switchTab so the global event
  // listener (registered once on mount) calls the up-to-date version.
  useEffect(() => {
    switchTabRef.current = switchTab;
  }, [switchTab]);

  useEffect(() => {
    updateHighlight();
    requestAnimationFrame(updateHighlight);
  }, [activeTab, i18n.language, updateHighlight]);

  useEffect(() => {
    window.addEventListener("resize", updateHighlight);
    return () => window.removeEventListener("resize", updateHighlight);
  }, [updateHighlight]);

  useEffect(() => {
    if (!animating) return;
    const timer = setTimeout(() => {
      setAnimating(false);
      setPrevTab(null);
    }, 250);
    return () => clearTimeout(timer);
  }, [animating]);

  const renderContent = (tab: TabId) => {
    switch (tab) {
      case "start":    return <StartTab onViewChange={onViewChange} />;
      case "kaart":    return <KaartTab />;
      case "ifc":      return <IfcTab />;
      case "rapport":  return <RapportTab onOpenProjectSettings={onProjectSettingsClick ?? (() => {})} />;
      case "tekening": return <SonderingstekeningTab />;
    }
  };

  return (
    <div className="ribbon-container">
      <div className="ribbon-tabs" ref={tabsRef}>
        <RibbonTab label={t("file")} isFileTab onClick={() => onFileTabClick?.()} />
        {TABS.map((tab) => (
          <RibbonTab
            key={tab}
            label={t(`${tab}Tab`)}
            isActive={activeTab === tab}
            onClick={() => switchTab(tab)}
          />
        ))}
        <div className="ribbon-tab-border" ref={borderRef} />
        <div className="ribbon-tab-gap" ref={gapRef} />
      </div>

      <div className="ribbon-content-wrapper">
        {animating && prevTab && (
          <div
            className={`ribbon-content-panel ribbon-panel-exit-${direction}`}
            key={`prev-${prevTab}`}
          >
            {renderContent(prevTab)}
          </div>
        )}
        <div
          className={`ribbon-content-panel${animating ? ` ribbon-panel-enter-${direction}` : ""}`}
          key={`active-${activeTab}`}
        >
          {renderContent(activeTab)}
        </div>
      </div>
    </div>
  );
}
