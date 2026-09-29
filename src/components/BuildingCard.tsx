import { ArrowUpRight, RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import { stateColors, stateLabels, stateLegendNotes } from "../domain/presentation";
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
 * One row of the district list. A building with open tasks says so here, not only once
 * it is opened — the same yellow mark the floor strip uses, because the list is the one
 * place a whole district is compared at a glance.
 */
export function BuildingCard({ name, address, floorCount, index, state, summary, selected, onSelect }: BuildingCardProps) {
  const hasFollowUp = summary.followUps > 0;
  return (
    <button className={`building-card ${selected ? "selected" : ""} ${hasFollowUp ? "has-followup" : ""}`} onClick={onSelect} aria-pressed={selected}>
      <div className="building-card-top"><span className="building-index">{String(index + 1).padStart(2, "0")}</span><strong>{name}</strong><ArrowUpRight size={16} /></div>
      <div className="building-address">{address}</div>
      {/* The pill states the colour; the tag states the task. Neither speaks for the other. */}
      <div className="building-status">
        <span className={`status-pill cf-status-${state.toLowerCase()}`} style={{ "--cf-state": stateColors[state] } as CSSProperties} title={stateLegendNotes[state]}><i />{stateLabels[state]}</span>
        {hasFollowUp && <span className="revisit-count" title={`${summary.followUps} 項待跟進`}><RotateCcw size={12} />{summary.followUps} 待跟進</span>}
      </div>
      <div className="building-progress"><span style={{ width: `${summary.total ? Math.min(100, summary.completed / summary.total * 100) : 0}%` }} /></div>
      <div className="building-card-meta"><span>{summary.total ? `${summary.completed} / ${summary.total} 個單位已查看` : "單位範圍待確認"}</span><span>{floorCount ? `${floorCount} 層` : "樓層未知"}</span></div>
    </button>
  );
}
