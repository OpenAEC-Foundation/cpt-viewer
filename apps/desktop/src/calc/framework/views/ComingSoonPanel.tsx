import type { CalcModule } from "../types";

export function ComingSoonPanel({ module }: { module: CalcModule }) {
  return (
    <div className="calc-coming-soon">
      <div className="calc-coming-soon-icon">🔜</div>
      <h2>{module.name}</h2>
      <p className="calc-coming-soon-norm">{module.norm}</p>
      <p className="calc-coming-soon-desc">{module.subtitle}</p>
      <p className="calc-coming-soon-hint">
        Deze module wordt nog gebouwd. Volg de roadmap op{" "}
        <a
          href="https://github.com/OpenAEC-Foundation/open-geotechniek-studio"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
