import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { ifcImportIcon, ifcExportIcon, ifcTreeIcon, ifcValidateIcon, ifcStatsIcon } from "./icons";

export default function IfcTab() {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("ifc.fileOps")}>
          <RibbonButton icon={ifcImportIcon} label={t("ifc.import")} />
          <RibbonButton icon={ifcExportIcon} label={t("ifc.export")} />
        </RibbonGroup>

        <RibbonGroup label={t("ifc.model")}>
          <RibbonButton icon={ifcTreeIcon} label={t("ifc.structure")} />
          <RibbonButton icon={ifcStatsIcon} label={t("ifc.statistics")} />
        </RibbonGroup>

        <RibbonGroup label={t("ifc.tools")}>
          <RibbonButton icon={ifcValidateIcon} label={t("ifc.validate")} />
        </RibbonGroup>
      </div>
    </div>
  );
}
