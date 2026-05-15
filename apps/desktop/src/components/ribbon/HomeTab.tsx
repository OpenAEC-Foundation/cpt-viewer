import { useTranslation } from "react-i18next";
import RibbonGroup from "./RibbonGroup";
import RibbonButton from "./RibbonButton";
import RibbonButtonStack from "./RibbonButtonStack";
import {
  pasteIcon,
  cutIcon,
  copyIcon,
  undoIcon,
  redoIcon,
  boldIcon,
  italicIcon,
  underlineIcon,
  alignLeftIcon,
  alignCenterIcon,
  alignRightIcon,
  pencilIcon,
  lineIcon,
  arrowIcon,
  circleIcon,
  rectangleIcon,
  imageIcon,
  tableIcon,
  linkIcon,
  projectIcon,
  settingsIcon,
  helpIcon,
  infoIcon,
} from "./icons";

interface HomeTabProps {
  onSettingsClick?: () => void;
  onProjectSettingsClick?: () => void;
}

export default function HomeTab({ onSettingsClick, onProjectSettingsClick }: HomeTabProps) {
  const { t } = useTranslation("ribbon");

  return (
    <div className="ribbon-content">
      <div className="ribbon-groups">
        {/* General */}
        <RibbonGroup label={t("home.general")}>
          <RibbonButton
            icon={projectIcon}
            label={t("home.project")}
            size="large"
            onClick={onProjectSettingsClick}
          />
          <RibbonButton
            icon={settingsIcon}
            label={t("home.settings")}
            size="large"
            onClick={onSettingsClick}
          />
        </RibbonGroup>

        {/* Clipboard */}
        <RibbonGroup label={t("home.clipboard", "Clipboard")}>
          <RibbonButton icon={pasteIcon} label={t("home.paste", "Paste")} size="large" />
          <RibbonButtonStack>
            <RibbonButton icon={cutIcon} label={t("home.cut", "Cut")} size="small" />
            <RibbonButton icon={copyIcon} label={t("home.copy", "Copy")} size="small" />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* History */}
        <RibbonGroup label={t("home.history", "History")}>
          <RibbonButtonStack>
            <RibbonButton icon={undoIcon} label={t("home.undo", "Undo")} size="small" />
            <RibbonButton icon={redoIcon} label={t("home.redo", "Redo")} size="small" />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Font */}
        <RibbonGroup label={t("home.font", "Font")}>
          <RibbonButtonStack>
            <RibbonButton icon={boldIcon} label={t("home.bold", "Bold")} size="small" />
            <RibbonButton icon={italicIcon} label={t("home.italic", "Italic")} size="small" />
            <RibbonButton icon={underlineIcon} label={t("home.underline", "Underline")} size="small" />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Paragraph */}
        <RibbonGroup label={t("home.paragraph", "Paragraph")}>
          <RibbonButtonStack>
            <RibbonButton icon={alignLeftIcon} label={t("home.alignLeft", "Align Left")} size="small" />
            <RibbonButton icon={alignCenterIcon} label={t("home.center", "Center")} size="small" />
            <RibbonButton icon={alignRightIcon} label={t("home.alignRight", "Align Right")} size="small" />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Drawing */}
        <RibbonGroup label={t("home.drawing", "Drawing")}>
          <RibbonButton icon={pencilIcon} label={t("home.pencil", "Pencil")} size="large" />
          <RibbonButtonStack>
            <RibbonButton icon={lineIcon} label={t("home.line", "Line")} size="small" />
            <RibbonButton icon={arrowIcon} label={t("home.arrow", "Arrow")} size="small" />
          </RibbonButtonStack>
          <RibbonButton icon={circleIcon} label={t("home.circle", "Circle")} size="large" />
          <RibbonButtonStack>
            <RibbonButton icon={rectangleIcon} label={t("home.rectangle", "Rectangle")} size="small" />
          </RibbonButtonStack>
        </RibbonGroup>

        {/* Insert */}
        <RibbonGroup label={t("home.insert", "Insert")}>
          <RibbonButton icon={imageIcon} label={t("home.image", "Image")} size="large" />
          <RibbonButton icon={tableIcon} label={t("home.table", "Table")} size="large" />
          <RibbonButton icon={linkIcon} label={t("home.link", "Link")} size="large" />
        </RibbonGroup>

        {/* Help */}
        <RibbonGroup label={t("home.help")}>
          <RibbonButton icon={helpIcon} label={t("home.helpBtn")} size="large" />
          <RibbonButton icon={infoIcon} label={t("home.about")} size="large" />
        </RibbonGroup>
      </div>
    </div>
  );
}
