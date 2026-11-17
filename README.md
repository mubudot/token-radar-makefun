# token-radar-makefun

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mubudot/token-radar-makefun/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mubudot/token-radar-makefun/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Ranks token launch candidates from the sealed protocol snapshot and provides costed farm plans. The offline dashboard separates trading peers and exclusions and exposes its valuation model.

## Run it

```sh
mkdir -p out && node main.ts --input ../token-radar-01-kit/input/snapshot.json --output out
# Open out/dashboard/index.html in your browser; file:// works.
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=pytfvkay&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>

## Implied value

The shared classic script `dashboard/model.js` runs in both Node and the browser. It uses the snapshot's TVL, seven-day change, tracking age and category; no protocol names or slugs determine value. The board covers all 40 watchlist records and ranks 198 candidates after generic category/name exclusions. A candidate **records no token**; the record does not establish that a token is absent.

```text
implied = round(F^0.75 × B^0.25)
F = exp(a_category) × (TVL / $100M)^beta × G_base^gamma × T_base^tau
B = TVL × global median market-cap/TVL ratio
```

The fitted component uses joint Huber regression and category intercepts shrunk toward the pooled intercept with weight n/(n+16). Thirty fixed iterations fit beta in [0,2], gamma in [0,3] and tau in [-3,3]. G_base is the square root of 1 plus clamped seven-day growth (−50% to +100%). T_base is the bounded tracking-age curve documented in `docs/CONTRACT.md`; missing dates use category/global medians, flagged explicitly. All calibration comes from the snapshot's positive-cap trading peers. This is a conditional market-cap proxy, not FDV, a token price or a launch forecast.

## Leave-one-out validation

Each target is excluded from all fitted coefficients, category pools, global priors and age-imputation pools. Model selection used these same diagnostics; they are not an untouched final test set. Shared token/product records limit independence.

| Model | n | Spearman | Median error factor | Within 3× |
| --- | ---: | ---: | ---: | ---: |
| Adopted ensemble | 128 | 0.423686 | 3.631260× | 55/128 (42.96875%) |
| Before: v2 | 128 | 0.398914 | 3.819854× | 59/128 (46.09375%) |
| Naive global-ratio baseline | 128 | 0.416150 | 5.069589× | 45/128 (35.15625%) |

The ensemble improves rank and median error; coverage drops 3.125 percentage points from v2, within the allowed four-point tradeoff. The fitted growth coefficient is zero in this snapshot. The negative fitted age exponent is a peer association, not evidence that younger protocols will launch.

## Farm budget

Every plan states the deposit and full capital at risk, gas per transaction, fees, setup time, hold horizon and exit steps. Principal is exposure, not a spent fee. The reported total is gas + fee reserve + opportunity cost + risk haircuts:

- `opportunity_apr = 0.05`: deposit × 5% × (hold days + assumed exit wait) / 365.
- `fee_buffer_bps = 25`: reserve 25 basis points at each of entry and exit.
- `smart_contract_haircut_rate = 0.01` and `depeg_haircut_rate = 0.01`: each reserves 1% of capital over the stated horizon. These are stress allowances, not measured probabilities; the entire deposit can be lost.
- Capital tiers are $25 test and $100/$250/$500 standard, derived from TVL; gas assumptions and all constants are visible on the Model tab and in board output.

## Screenshots

`screenshots/1-board.png`, `2-detail.png`, `3-filtered.png`. The operator refreshes them after UI/model changes. The capture tool enforces three lossless images of 300,000–350,000 bytes each and a dossier no larger than 1.5 MiB.

## Tools

```sh
node tools/gate.ts out --input ../token-radar-01-kit/input/snapshot.json
node tools/check.ts ../token-radar-01-kit/input/snapshot.json out
bash tools/determinism.sh ../token-radar-01-kit/input/snapshot.json
# Operator capture; requires Playwright via PLAYWRIGHT_PKG or sibling shot-tools:
node tools/shoot.mjs --input ../token-radar-01-kit/input/snapshot.json
```

Node 22.18+; the entry runs with the standard library only and no network. `--input` accepts a file or directory; output uses `--output`, then `MAKEFUN_OUTPUT_DIR`, then `/output`. Generated `out/` is gitignored.

Author: Ethan Moore (mubudot).

AI usage: built by AI coding agents (Codex, Antigravity) directed by an orchestrating agent.
