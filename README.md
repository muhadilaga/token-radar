# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/muhadilaga/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/muhadilaga/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks 198 clean pre-token DeFi launches by implied launch value, scored from a sealed DefiLlama snapshot (14 Nov 2026) with the radar-2 model: sub-linear size, clamped 7-day growth, a hump-shaped maturity curve, and chain breadth. Another 91 wrapped, staked and bridged products are scored the same way and listed separately, never ranked with launches. Every protocol gets a six-step farm plan with costs and times. The dashboard is a static, offline page: a sortable and filterable board, a per-protocol detail view with the model's own factors, live-token and derivative views, and a model sandbox that re-ranks the board under different constants.

## Run it

The snapshot is the competition's sealed input and is not shipped in this repository: the grader mounts it at `/input/snapshot.json`, which is also where `main.ts` reads it by default. To run it yourself, point `--input` at the kit's snapshot:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-kit>/input/snapshot.json
```

Node 22.18 or later, standard library only, nothing to install. The run writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. It is deterministic: run it twice and the directories are byte-identical.

## The model

`implied = round( tvl ^ 0.5 x 5000 x (1 + clamp(change_7d, -50, 100) / 100 x 0.6) x (0.55 + 0.6 x exp(-((age - 730) / 800)^2)) x (1 + 0.04 x min(chains - 1, 10)) x derivative )`

- **Size** is sub-linear: doubling locked value does not double launch value.
- **Growth** is clamped, so one wild week cannot carry a row.
- **Maturity** is a hump peaking around two years of track record: very young is unproven, very old has likely decided not to launch.
- **Breadth** across chains adds a little; a **derivative** product (wrapped, staked, bridged, or named after an exchange) is flagged and discounted to 0.85, because its launch is its underlying's, not its own.

No protocol name is special-cased. The dashboard states the constants and lets the reader move them in a sandbox; the submitted board always uses the defaults.

## Layout

- `main.ts` — the entrypoint: reads the snapshot, writes the board, the dashboard data, and the dossier.
- `lib/model.ts` — the radar-2 model, the farm plans, and the board's own gate checks.
- `dashboard/` — the static page: `index.html`, `app.css`, `app.js`. No framework, no network.
- `screenshots/` — the board, a detail view, and a filtered view.
- `vendor/makefun-board.ts` — make.fun's dossier library, copied from the kit.

---

<sub>Entered on [make.fun](https://make.fun/?ref=1076061580.1795206831.1795206830~t.co~referral~~~t.co&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
