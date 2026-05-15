import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import { extensionBrowseIcon, extensionInstallIcon, extensionManageIcon } from "./icons";

export default function ExtensionsTab() {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        <RibbonGroup label={t("extensions.catalog")}>
          <RibbonButton icon={extensionBrowseIcon} label={t("extensions.browse")} />
          <RibbonButton icon={extensionInstallIcon} label={t("extensions.install")} />
        </RibbonGroup>

        <RibbonGroup label={t("extensions.manage")}>
          <RibbonButton icon={extensionManageIcon} label={t("extensions.settings")} />
        </RibbonGroup>
      </div>
    </div>
  );
}
