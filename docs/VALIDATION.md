# Account system validation — 2026-09-26

Implemented on top of local repair commit `f40d7c6` on `codex/downstream-audit`. The attempted push to `lhjlol/Careflow-Atlas` was rejected with HTTP 403 for OscarXuHz; no further remote push was attempted.

| Check | Current result |
| --- | --- |
| TypeScript / ESLint / Git whitespace / shell syntax | Passed |
| Existing domain/import/store regressions plus account cache isolation | 18 files, 114 passed |
| Account HTTP/database integration tests | 16 passed |
| Nginx production browser account flows | 14 passed |
| Existing workbench production browser regression | 15 passed, 0 failed, 0 unverified |
| Docker account stack | Build, health, proxy, unauthenticated rejection, repeated-bootstrap rejection, service restart, consistent backup and integrity check passed |

The account browser suite verifies activation from an already-open login page, login, reload persistence, invitations, member authorization, per-account demo cache isolation, cross-tab logout, disable/recheck without reload, password recovery/change, idle polling stopping without activity and mobile settings. Backend tests additionally exercise CSRF/Origin, session expiry, persisted throttling, last-admin protection, hashing races, concurrent one-time-link redemption, schema downgrade refusal and backup restore.

Runtime: host Node 25.6.1; Docker Node 24.15.0 + Nginx on local Apple Silicon; isolated Playwright Chromium contexts. No live accounts or production databases were used. Test resources were cleaned by the isolated verification script.

Evidence is delivered beside the repository under `../evidence/accounts-*.log` and `../evidence/account-settings-mobile.png`. Reproduction and setup: [ACCOUNTS.md](ACCOUNTS.md).

Limits: no VPS, DNS/TLS or amd64 verification; no MFA, SSO, SMTP/email-ownership verification, or shared business database. Account recovery uses administrator-issued one-time links or a VPS operator CLI. Business data remains synthetic browser-local state, not a production data service. Account backup/restore was verified locally; offsite disaster recovery needs a deployment-specific drill.

---

# Validation and handover

## Previous import/deployment audit — 2026-09-26

Base: `lhjlol/Careflow-Atlas` at `f0a56ebbb36e896d755aa6317018d82f1c54b385`. Changes and evidence: [AUDIT_2026-09-26.md](AUDIT_2026-09-26.md).

Actual host runtime: Node 25.6.1 / npm 11.9.0. Container build: Node 24.15.0. Docker 28.3.3 / Compose 2.39.2 through OrbStack, Apple Silicon arm64. Browser: Playwright 1.63.0, Chromium 153.0.8010.12, isolated contexts.

| Check | Result |
| --- | --- |
| Locked dependency install | Passed with `npm ci` on host and in container |
| Demo generation | Passed; tracked workbook bytes unchanged |
| TypeScript / ESLint | Passed |
| Unit and integration tests | 18 files, 113 tests passed (baseline: 14 files, 91 tests) |
| Production build | Passed, including the separately bundled MapLibre worker |
| npm audit | 0 reported vulnerabilities |
| Docker verification | 34 checks passed, including independent `nginx -t`, routing, cache headers, health, port mapping, rebuild/restart and image save/load |
| Browser on Nginx production output | 15 passed, 0 failed, 0 unverified |
| Git whitespace/diff check | Passed |

Browser checks cover startup, mapping change invalidating old pending data, Chinese sample import, exact persistence after reload, building/floor/unit navigation, append-only observations, 20-building district merge retaining older history, Excel/JSON downloads, legacy workbook merge, paper preview, actual 3D floor label clicks, 390×844 mobile form layout, local resource failures, successful external vector tile responses, missing `crypto.randomUUID` compatibility and blocked-map-network fallback.

Run `VERIFY_BROWSER=1 bash deploy/verify.sh` after installing the optional Playwright tool and its Chromium browser. It uses a private browser context and unique test containers/images. Plain `bash deploy/verify.sh` reports the browser check as manual rather than pretending it ran.

The checks do not establish remote VPS deployment, amd64 compatibility, actual NGO data suitability, real mobile hardware behavior, multi-tab transactional writes or protection against arbitrary compressed-workbook attacks. Local storage remains unencrypted and unshared. W0 mapping edits are preview-only and require a corrected source file to be reloaded; unimplemented template formats cannot write records.

## Historical validation — 2026-09-11

The following records the original prototype verification and its contemporary limits; counts and dependency versions here are historical.


Verified 2026-09-11 HKT using Node 22.12.0, npm 10.9.0, and the Codex in-app Chromium browser.

## Automated checks

`npm run typecheck`, `npm run lint`, `npm test`, and the production build are the release checks. The 23 tests cover actual workbook parsing and row errors; relational schema, dates and follow-up closure; persistence failure and idempotency; occurrence-time ordering and scoped coverage; and floor geometry/map data isolation.

## Browser checks actually performed

- At 1440×900, parsed the generated workbook through the sample-import UI: 4 buildings, 2 people, 36 units and 25 observations; blank coverage produced an explicit warning before confirmation.
- Selected 裕安樓, verified the camera transition and fully separated eight-floor stack, selected the amber georeferenced 5F label, and opened 5B history. Native canvas extrusion picking separately selected 4F and updated the same detail state.
- Saved an explicit completed/contacted result while leaving assessment unchanged and closing the existing revisit. Completed units changed 16→17 of 32, building follow-ups 1→0, total follow-ups 2→1. Both events and the earlier suspected assessment remained visible.
- Reloaded and verified persistence. At 390×844, used list mode, selected 5F/5B and opened/cancelled the record form. Document width equalled viewport width (390px).
- Verified optional WebMCP summary/navigation and rejection of an unknown building ID. No console errors appeared in the final fresh-page log segment.

## Limits of this verification

Browser checks were interactive, not an automated E2E suite. The disk file picker, real iOS Safari/Android hardware, forced WebGL loss, offline map startup, large malicious/compressed workbooks, cross-tab writes, and remote multi-user conflicts were not independently stress-tested. Repository write/quota failure is covered with an adapter test. This prototype supports synthetic local state only; the synthetic metadata flag is not a personal-data detector.

MapLibre is the largest lazy chunk; performance on low-end field devices needs measurement. Local storage can be cleared and is not encrypted, backed up or synchronised. Production persistence requires authenticated server APIs, granular writes, concurrency handling, and migration/version policy; swapping an adapter alone does not provide these guarantees.
