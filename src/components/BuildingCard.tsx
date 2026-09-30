import { RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import { stateColors, stateLabels } from "../domain/presentation";
import type { CoverageSummary, State } from "../domain/types";

export interface BuildingCardProps {
  name: string;
  address: string;
  floorCount?: number;
  index: number;
  state: State;
  summary: CoverageSummary;
  selected: boolean;
  onSelect: () => void;
}

/**
 * One entry of the district index: number, state, name, then the figures after a
 * leader — completed units and open tasks. A building with open tasks says so here,
 * because the index is where a whole district is compared at a glance.
 */
export function BuildingCard({ name, address, floorCount, index, state, summary, selected, onSelect }: BuildingCardProps) {
  const tasks = summary.followUps;
  const described = `${name} · ${address} · ${stateLabels[state]}${summary.total ? ` · ${summary.completed}/${summary.total} 個單位已查看` : ""}${floorCount ? ` · ${floorCount} 層` : ""}${tasks ? ` · ${tasks} 項待跟進` : ""}`;
  return (
    <button className={`building-row${selected ? " selected" : ""}${tasks ? " has-followup" : ""}`} onClick={onSelect} aria-pressed={selected} aria-label={described} title={described}>
      <span className="building-row__n">{String(index + 1).padStart(2, "0")}</span>
      <span className="building-row__name"><i style={{ "--cf-state": stateColors[state] } as CSSProperties} aria-hidden="true" />{name}</span>
      <span className="building-row__leader" aria-hidden="true" />
      <span className="building-row__v">
        <span>{summary.total ? <><b>{summary.completed}</b>/{summary.total}</> : "—"}</span>
        {tasks > 0 && <span className="building-row__task"><RotateCcw size={11} aria-hidden="true" />{tasks}</span>}
      </span>
    </button>
  );
}
