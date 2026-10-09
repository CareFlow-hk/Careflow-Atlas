export interface IssueView { sheet?: string; row?: number; field?: string; message: string; severity?: "error" | "warning"; code?: string; detail?: string; }
export interface IssueGroup { severity: "error" | "warning"; sheet?: string; field?: string; message: string; code?: string; rows: number[]; details: string[] }

/** The same message on many rows is one problem, not many: show it once with its rows. */
export function groupIssues(issues: IssueView[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>();
  for (const issue of issues) {
    const severity = issue.severity ?? "error";
    const key = [severity, issue.sheet, issue.field, issue.code, issue.message].join("\u0000");
    const group = groups.get(key) ?? { severity, sheet: issue.sheet, field: issue.field, message: issue.message, code: issue.code, rows: [], details: [] };
    if (issue.row) group.rows.push(issue.row);
    if (issue.detail) group.details.push(issue.row ? `第 ${issue.row} 行：${issue.detail}` : issue.detail);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));
}

