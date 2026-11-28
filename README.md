# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/muhadilaga/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/muhadilaga/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 198 clean pre-token DeFi launches by implied launch value, scored from a sealed DefiLlama snapshot (14 Nov 2026) with the radar-3 model: a launch value fitted by OLS on the snapshot's traded-token protocols (log market cap on log TVL, log age and chain count), times token odds from a logistic fit on age, with held-out validation numbers printed in the dashboard. Seven-day growth was fitted and dropped — its effect is indistinguishable from zero. Another 91 wrapped, staked and bridged products are scored the same way and listed separately, never ranked with launches. Every protocol gets a seven-step farm plan with costs and times. The dashboard is a static, offline page: a sortable and filterable board, a per-protocol detail view with the model's own factors, live-token and derivative views, a coverage strip and self-audit, and a model sandbox that re-ranks the board under different constants.

## Run it

The snapshot is the competition's sealed input and is not shipped in this repository: the grader mounts it at `/input/snapshot.json`, which is also where `main.ts` reads it by default. To run it yourself, point `--input` at the kit's snapshot:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-kit>/input/snapshot.json
```

Node 22.18 or later, standard library only, nothing to install. The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. It is deterministic: run it twice and the directories are byte-identical.

## The model

`launch = 10 ^ (4.330 + 0.432 x log10(TVL) - 0.227 x log10(age) + 0.018 x extra chains)`, fitted by OLS on 95 traded-token protocols (R² 0.18, leave-one-out error x4.54, walk-forward error x10.27)

`odds = 1 / (1 + exp(-(-3.936 + 1.447 x log10(age))))`, fitted by logistic regression on 645 protocols (44% at one year, 55% at two, 66% at four)

`implied = round( launch x odds x derivative )`

- **Size** is sub-linear: doubling locked value does not double launch value. The coefficients are fitted, not chosen — re-run `main.ts` and they are re-fitted from the snapshot.
- **Growth** was fitted and dropped: its effect on launch value is indistinguishable from zero, so the model sets it to zero instead of letting noise punish growing protocols.
- **Age** pulls both ways: older listed tokens are worth less at the same TVL, but older cohorts list tokens more often. The net effect is shown per row.
- **Breadth** across chains adds a little; a **derivative** product (wrapped, staked, bridged, or named after an exchange) is flagged and discounted to 0.85, because its launch is its underlying's, not its own.

No protocol name is special-cased. The dashboard states the fitted coefficients and the validation numbers and lets the reader move them in a sandbox; the submitted board always uses the fitted values.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes the board, the dashboard data, and the dossier.
- `lib/model.ts` — the radar-3 fitted model, the farm plans, and the board's own gate checks.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No framework, no network.
- `screenshots/` — the board, a detail view, a filtered view, and the fitted-model view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1076061580.1795206831.1795206830~t.co~referral~~~t.co&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
