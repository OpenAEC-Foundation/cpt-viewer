import { useTranslation } from "react-i18next";

const ROBERTSON_ZONES = [
  { number: 1, name: "Gevoelig fijnkorrelig",  color: "#00BCD4" },
  { number: 2, name: "Organisch / veen",        color: "#795548" },
  { number: 3, name: "Klei",                    color: "#4CAF50" },
  { number: 4, name: "Silt mengsels",           color: "#8BC34A" },
  { number: 5, name: "Zand mengsels",           color: "#FFC107" },
  { number: 6, name: "Zand",                    color: "#FF9800" },
  { number: 7, name: "Grof zand / grind",       color: "#FF5722" },
  { number: 8, name: "Zeer vast zand/klei",     color: "#F44336" },
  { number: 9, name: "Zeer vast fijnkorrelig",  color: "#9C27B0" },
];

export default function RightPanel() {
  const { t } = useTranslation("cpt");
  return (
    <div className="right-panel-body">
      <h3 className="right-panel-title">{t("robertsonSbt", "Robertson SBT")}</h3>
      <ul className="sbt-legend">
        {ROBERTSON_ZONES.map((z) => (
          <li key={z.number}>
            <span className="sbt-swatch" style={{ background: z.color }} />
            <span className="sbt-num">{z.number}</span>
            <span className="sbt-name">{z.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
