# AGENTS.md — CareFlow Atlas

给 Codex 等编程 agent 的工作约定。完整规则以 [CLAUDE.md](CLAUDE.md) 为准，动手前先读完它；本文件只重复最容易漏掉的一条。

## Prompt 日志（必须遵守）

每一条发给 AI 的 prompt 都要原文记进 `log/`，详细规则见 CLAUDE.md 第 9 节：

- 一天一个文件：`log/YYYY-MM-DD.md`，日期按香港时间（`TZ=Asia/Hong_Kong date '+%Y-%m-%d %H:%M:%S'`）。
- 每收到一条 prompt（包括中途追加的消息），动手之前先追加一段：

  ```markdown
  ## 20:47:04 · 小刘 · Codex

  > prompt 原文
  ```

- 原文照录，不改写、不摘要；只把密码、API key、token、一次性链接、真实个人资料改成 `[已遮蔽：…]`。仓库是公开的。
- 只追加，不改写旧记录；随同一次改动一起 commit。
