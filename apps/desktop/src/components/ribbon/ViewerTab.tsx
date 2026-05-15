import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import {
  viewerLoadIcon, viewerOrbitIcon, viewerSectionIcon,
  viewerMeasureIcon, viewerFitIcon, viewerWireframeIcon,
} from "./icons";

export default function ViewerTab() {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("viewer.file")}>
          <RibbonButton icon={viewerLoadIcon} label={t("viewer.loadModel")} />
        </RibbonGroup>

        <RibbonGroup label={t("viewer.navigation")}>
          <RibbonButton icon={viewerOrbitIcon} label={t("viewer.orbit")} />
          <RibbonButton icon={viewerFitIcon} label={t("viewer.fitAll")} />
        </RibbonGroup>

        <RibbonGroup label={t("viewer.analysis")}>
          <RibbonButton icon={viewerSectionIcon} label={t("viewer.section")} />
          <RibbonButton icon={viewerMeasureIcon} label={t("viewer.measure")} />
        </RibbonGroup>

        <RibbonGroup label={t("viewer.display")}>
          <RibbonButton icon={viewerWireframeIcon} label={t("viewer.wireframe")} />
        </RibbonGroup>
      </div>
    </div>
  );
}
