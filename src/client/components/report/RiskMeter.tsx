import { riskLabels, riskLevels, type RiskLevel } from "../../../shared/report";
import { cn } from "@/lib/cn";
import { levelFillClass, levelTextClass } from "./levels";

export function RiskMeter({ level }: { level: RiskLevel }) {
  return (
    <div>
      <p className="sr-only">Risk level: {riskLabels[level]}</p>
      <ol className="grid grid-cols-5 gap-1.5" aria-hidden="true">
        {riskLevels.map((step) => (
          <li key={step} className="flex flex-col gap-1.5">
            <span className={cn("h-2.5 rounded-[1px] border border-rule", step === level ? levelFillClass[step] : "bg-panel-2")} />
            <span
              className={cn(
                "font-mono text-[0.62rem] uppercase leading-tight tracking-wider",
                step === level ? cn(levelTextClass[step], "font-medium") : "text-ink-faint",
              )}
            >
              {riskLabels[step]}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
