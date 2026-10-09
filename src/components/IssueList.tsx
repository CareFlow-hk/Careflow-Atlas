import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { IssueView } from "./issueGroups";
import { groupIssues } from "./issueGroups";


function rowsLabel(rows: number[]) {
  if (!rows.length) return "";
  const sorted = [...new Set(rows)].sort((a, b) => a - b);
  if (sorted.length <= 4) return `第 ${sorted.join("、")} 行`;
  return `第 ${sorted[0]}–${sorted.at(-1)} 行等 ${sorted.length} 行`;
}

/** Staff read the message; the folded part is for us when they send a screenshot. */
export function IssueList({ issues }: { issues: IssueView[] }) {
  const groups = groupIssues(issues);
  const errors = groups.filter(g => g.severity === "error").length, notes = groups.length - errors;
  return (
    <div className="cf-issues">
      <h3>檢查結果 {groups.length > 0 && <span>{[errors && `要修正 ${errors} 項`, notes && `提示 ${notes} 項`].filter(Boolean).join("・")}</span>}</h3>
      {groups.length === 0 ? <p className="cf-success"><CheckCircle2 />未發現問題。</p> : (
        <ol className="cf-issue-list" aria-label="檢查結果">
          {groups.map((g, i) => (
            <li key={i} className={`cf-issue is-${g.severity}`}>
              <div className="cf-issue__where">
                <span className="cf-issue__badge">{g.severity === "error" ? <><AlertTriangle size={13} />要修正</> : <><Info size={13} />提示</>}</span>
                <span>{[g.sheet, rowsLabel(g.rows), g.field].filter(Boolean).join(" · ")}</span>
              </div>
              <p className="cf-issue__message">{g.message}</p>
              <details className="cf-issue__tech">
                <summary>技術資料</summary>
                <dl>
                  <dt>代碼</dt><dd>{g.code ?? "—"}</dd>
                  <dt>位置</dt><dd>{[g.sheet ?? "—", g.rows.length ? `rows ${[...new Set(g.rows)].join(",")}` : "", g.field].filter(Boolean).join(" / ")}</dd>
                  {g.details.length > 0 && <><dt>詳情</dt><dd><pre>{g.details.slice(0, 12).join("\n")}{g.details.length > 12 ? `\n…另 ${g.details.length - 12} 項` : ""}</pre></dd></>}
                </dl>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
