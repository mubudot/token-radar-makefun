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
G = exp(0.20 × clip(ln(1 + g7), −ln(2), +ln(2)))   # g7 = change_7d / 100
F = exp(a_category) × (TVL / $100M)^beta × T_base^tau
B = TVL × global median market-cap/TVL ratio
implied = round(F^0.75 × B^0.25 × G) = round(TVL × M_eff × G × T)
```

Growth has a **fixed stated prior**, `w=0.20`, with log bounds **±ln(2)** (equivalent to clipping seven-day growth to −50%…+100%). Its applied factor is bounded at **0.870551–1.148698×**. A volatile week merits a modest directional effect; its strength is not estimated from this noisy cross-section or tuned to LOO scores. Missing growth is neutral and flagged. The growth prior applies outside the ensemble, so blending cannot erase it.

The fitted component uses Huber regression on `log(mcap) − log(G)`, with category intercepts shrunk toward the pooled intercept by n/(n+16). Thirty fixed iterations fit beta in [0,2] and tau in [−3,3]. Subtracting the fixed growth contribution from training targets prevents fitting it again. The existing 75%/25% ensemble choice is retained.

`T_base = .80 + .35(1−exp(−d/365)) − .15(1−exp(−max(d−730,0)/730))`, and the applied `T = T_base^(0.75 tau)`. Full-snapshot tau is −2.769052513, so T's exponent is −2.076789384 and age retains a substantial effect. This inverse association is not causal launch evidence. **Days without token is a tracking-age proxy** for records currently recording no token; `listed_at` does not supply token issue history. Missing dates use flagged category/global median ages, then a 365-day fallback. Both factors, raw growth %, days, and imputation status appear in project detail; the Model tab explains them.

This is a conditional market-cap proxy, not FDV, a token price or a launch forecast.

## Leave-one-out validation

Each of the 128 targets is excluded from coefficients, category pools, global priors and age-imputation pools, then predicted with its own inputs. Every fold is refitted. Earlier model selection used this snapshot; these diagnostics are not an untouched test set. Shared token/product records limit independence.

| Model | n | Spearman | Median error factor | Within 3× |
| --- | ---: | ---: | ---: | ---: |
| Before: v3 (fitted G=1) | 128 | 0.4236861381 | 3.6312601531× | 55/128 (42.96875%) |
| Current: v4 (fixed growth prior) | 128 | 0.4232626808 | 3.5851157159× | 57/128 (44.53125%) |
| Naive global-ratio baseline | 128 | 0.4161497436 | 5.0695886515× | 45/128 (35.15625%) |

Median absolute log10 error is **0.5545031778** (before **0.5600573640**); baseline **0.7049727219**. Rank correlation slips slightly from v3; median error and coverage improve. The Model tab reports the recomputed current and baseline metrics directly from predictions. Historical v3 figures above were captured before the change on the same sealed input; old v1/v2 runtime comparison fits were removed.

## Farm budget

Every plan states the deposit and full capital at risk, gas per transaction, fees, setup time, hold horizon and exit steps. Principal is exposure, not a spent fee. The reported total is gas + fee reserve + opportunity cost + risk haircuts:

- `opportunity_apr = 0.05`: deposit × 5% × (hold days + assumed exit wait) / 365.
- `fee_buffer_bps = 25`: reserve 25 basis points at each of entry and exit.
- `smart_contract_haircut_rate = 0.01` and `depeg_haircut_rate = 0.01`: each reserves 1% of capital over the stated horizon. These are stress allowances, not measured probabilities; the entire deposit can be lost.
- Capital tiers are $25 test and $100/$250/$500 standard, derived from TVL; gas assumptions and all constants are visible on the Model tab and in board output.

## Screenshots

`screenshots/1-board.png`, `2-detail.png`, `3-filtered.png`. The operator must refresh them after this UI/model change. `tools/shoot.mjs` still captures board, detail and filtered views at 1440×900; detail selects Galaxy Curation on this snapshot (+11.2334% seven-day growth, 177 observed days, G=1.021520×, T=1.151089×), and checks both factors and inputs are inside the viewport. The capture tool enforces three lossless images of 300,000–350,000 bytes each and a dossier no larger than 1.5 MiB.

## Tools

```sh
node tools/gate.ts out --input ../token-radar-01-kit/input/snapshot.json
node tools/check.ts ../token-radar-01-kit/input/snapshot.json out
bash tools/determinism.sh ../token-radar-01-kit/input/snapshot.json
# Operator capture; requires Playwright via PLAYWRIGHT_PKG or sibling shot-tools:
node tools/shoot.mjs --input ../token-radar-01-kit/input/snapshot.json
```

Readable dashboard sources target **≤62,500 UTF-8 bytes**; tests also rebuild the vendor dossier at a **64,000-byte text cap**, including listings, headings and code fences, and require complete source with no cut. The canonical vendor/gate cap stays 65,536 bytes. `tools/compact.cjs` was removed; no minifying formatter runs during build.

Node 22.18+; the entry runs with the standard library only and no network. `--input` accepts a file or directory; output uses `--output`, then `MAKEFUN_OUTPUT_DIR`, then `/output`. Generated `out/` is gitignored.

Author: Ethan Moore (mubudot).

AI usage: built by AI coding agents (Codex, Antigravity) directed by an orchestrating agent.
