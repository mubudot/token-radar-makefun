# Radar model and dashboard contract

`peer-radar-4` is the current implementation. This document replaces the conflicting historical v1/v2/v3 handoffs. `dashboard/model.js` is one readable classic script shared by Node and the browser. No install, network, wall clock or random input is required. The operator owns commits and screenshot capture.

## Inputs, partitions and ordering

`RADAR_DATA` is the untouched sealed snapshot: `as_of`, `floor_usd`, `watchlist`, and `protocols`. Each protocol supplies slug, name, category, chains, TVL, seven-day change in percent, market cap, listing date, Gecko identifier and symbol. `main.ts` emits it as `out/data.js`; load `../data.js`, `model.js`, then `app.js`.

`classify(p)` returns `trades` for positive market cap, otherwise `token-recorded` if an identifier/symbol exists, else `pre-token`. `isRankable(p)` requires pre-token status and no observable watchlist exclusion, without the $50M TVL floor. `exclusionRules(p)` lists every matching category/name rule:

- Categories: Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX.
- Trailing version: `/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/`.
- Whole product word: `/\b(wrapped|staked|staking)\b/i`.
- Exchange prefix: `/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i`.

The snapshot has **198 board candidates, 40/40 watchlist coverage, 158 off-watchlist, 138 below floor; 128 trading peers; 288 token-recorded and 144 pre-token exclusions** (128 match category rules). Conservation: 198 + 128 + 288 + 144 = 758. Matching rules overlap. Watchlist membership does not boost value. Names affect screening only, never fitted value.

Ranks descend by whole-dollar implied value, ties by code-unit slug; `rank` is immutable under UI sorting. Trading peers and excluded records are separate. Say **records no token**, since neither token absence nor parent relationships are verified by these fields.

## Value model and stated growth prior

All logs below are natural logs. With `g7 = change_7d / 100`:

```text
G = exp(w × clip(ln(1+g7), −a, +a))
w = 0.20; a = ln(2)
F = exp(a_category) × (TVL / $100M)^beta × T_base^tau
B = TVL × clamp(global median(mcap/TVL), 0.02, 5)
implied = clamp(round(F^0.75 × B^0.25 × G), 1, 100000000000000)
```

Growth is a **modest fixed momentum prior**, not a coefficient fitted to a volatile week or tuned against these LOO scores. It gives seven-day TVL change a real directional role while bounding extrapolation. It is applied outside the geometric ensemble, so its final weight remains 0.20. `growth_log_clip=Math.LN2`; percentage bounds −50% and +100% are equivalent. Code clips percent before taking `log1p`, so even −100% or lower stays finite. Missing growth uses zero percent, G=1, and a flag. G ranges from **0.8705505633× to 1.1486983550×**.

Huber regression fits `y = log(mcap) − log(G)` against `x = log(TVL/$100M)`, `log(T_base)` and category. Growth is subtracted from the target rather than offered as a free regression coordinate. Thirty deterministic iterations use shrunk category median residual offsets, residual Huber weights (delta 1.345; MAD multiplier 1.4826; scale floor 0.1), bounded weighted coordinate slopes, and a median pooled intercept. Initialize size/age slopes at 0.5/1. Bound beta to [0,2] and tau to [−3,3]. Final category intercepts shrink with weight `n/(n+16)` toward the pooled intercept; zero-peer categories use the pool. All positive-cap/positive-TVL peers participate, including excluded ranking categories.

The existing 75% fit / 25% global-ratio ensemble and shrinkage choice were previously selected on this snapshot. They are retained without a new parameter sweep. `multiple_floor/cap` clamp only the baseline ratio, not the fitted effective multiple.

The emitted breakdown uses ensemble-adjusted intercept and beta:

```text
a_eff = .75 × a_category + .25 × log($100M × global_ratio)
beta_eff = .75 × beta + .25
M_eff = (exp(a_eff) / $100M) × (TVL / $100M)^(beta_eff − 1)
T = T_base^(.75 × tau)
implied = round(TVL × M_eff × G × T)
```

Only the final value is rounded. Use `implied_value_usd` in the UI, rather than multiplying rounded display factors. This is an implied market-cap proxy, not FDV, price, rewards or launch odds. Supplies, allocations and reliable historical launch outcomes are absent; TVL and shared tokens may overlap.

## Tracking days and meaningful T

```text
d = max(0, floor((as_of − listed_at)/one UTC day))
rise = .35 × (1 − exp(−d/365))
fade = .15 × (1 − exp(−max(d−730,0)/730))
T_base = .80 + rise − fade
T = T_base^(.75 × tau)
```

For currently pre-token records, d is labelled **days without token (tracking-age proxy)**. Listing date is when tracking began, not a verified tokenless start date; the snapshot has no token issue history. Trading-peer validation uses tracking age, not a claim the peer still lacks a token. Null dates use the category median known age, then global median, then 365 days; flag the imputation and source. Pools include all known-age protocols after removing the LOO target. Half-day median imputations remain possible.

At 0/365/730/1095 days, T_base is approximately 0.800/1.021/1.103/1.074; it tends toward 1 for very old records. Both this curve and the exponent bounds constrain T. Effective exponent stays in [−2.25,+2.25]. The full fit has beta **0.5281635902**, tau **−2.7690525126**, effective beta **0.6461226927**, effective time exponent **−2.0767893844**. The inverse age association is disclosed, not treated as causal launch evidence. Age has a substantial applied effect.

## Honest leave-one-out diagnostics

Remove the target from every coefficient fit, category/global prior, and age-imputation pool. Then predict that target using its own observed inputs or the training-only imputation. Refit independently for all 128 traded peers. The baseline uses each fold's held-out global-ratio median times TVL, with no category, G or T. Average ranks for ties before Spearman correlation. Median error factor is `10^median(abs(log10(predicted/actual)))`; within-3× is inclusive.

| Same sealed input, n=128 | Spearman | Median error × | Within 3× | Median absolute log10 error |
| --- | ---: | ---: | ---: | ---: |
| Before: v3, fitted G=1 | 0.4236861381 | 3.6312601531 | 55/128 = 42.96875% | 0.5600573640 |
| Current: v4, fixed G prior | 0.4232626808 | 3.5851157159 | 57/128 = 44.53125% | 0.5545031778 |
| Global-ratio baseline | 0.4161497436 | 5.0695886515 | 45/128 = 35.15625% | 0.7049727219 |

Spearman declines slightly from v3, while median error and coverage improve. There are 33 imputed peer ages and zero missing peer growth inputs. The Model tab reports current and baseline metrics from actual held-out predictions, not hardcoded numbers. The table's historical v3 figures were captured before this change on the same input. Old v1/v2 comparison fits, fields and duplicated UI tables were removed to keep readable current source within budget. `validation.before` and `.legacy` no longer exist.

LOO was used in earlier model selection, so these are **selection diagnostics, not an untouched future test set**. Shared tokens/product records limit independence. Tests verify prediction isolation and metric arithmetic; they do not demand every metric improve.

## Shared API and output

`RadarModel` exports `VERSION`, `CONSTANTS`, `METHOD`, `FARM`, `GAS`, `FAMILY`, `EXCLUDED_CATEGORIES` and these functions:

| Function | Purpose |
| --- | --- |
| `classify`, `exclusionRules`, `isRankable`, `categoryOf` | Partition/screen records consistently. |
| `ageDays(asOf, listedAt)` | Observed UTC tracking days or null. |
| `deriveMultiples(protocols, asOf, omitSlug?)` | Rebuild training-only pools, fitted category intercepts and global ratio. |
| `impliedValue(protocol, calibration)` | Exact factor breakdown and final rounded value. |
| `spearman(x, y)` | Tie-aware rank correlation, null for degenerate vectors. |
| `validatePeers(protocols, asOf)` | `{stats, peers}` with independently held-out predictions. |
| `familyOf`, `cheapestChain`, `buildFarmPlan` | Conditional category action and complete cost ledger. |
| `buildRadar(snapshot)` | Complete deterministic browser/board view model. |

`buildRadar` returns `as_of`, `floor_usd`, `version`, constants/method/farm/gas tables, `calibration`, `category_multiples`, `validation`, ranked `rows`, `trading_peers`, `excluded`, and `summary`. Inputs are never mutated, and reversing input order leaves the entire result byte-identical.

A ranked row preserves raw fields and adds rank, pre-token status, watchlist membership, observed `age_days`, implied value, `model`, flags, `farm_plan`, and `farm_steps` exactly equal to `farm_plan.steps.map(s => s.text)`. Exclusions carry reason and matching rules. A trading peer has actual cap, held-out model, predicted value/market ratio, absolute log10 error, within-3× status and baseline value; it receives no candidate rank.

The current breakdown contains:

- `multiple`: category peer count/slugs and age pool metadata, category fit, global peer count, omission slug, applied `factor` and `size_factor`.
- `growth`: `raw_pct`, `used_pct`, `used_log`, fixed `weight`, `log_clip`, `missing`, `clamped`, applied `factor`. There is no fitted growth power.
- `time`: observed `age_days`, `used_days`, `imputed`, `source`, `base_factor`, applied `fit_power` and `factor`.
- `fit`: effective beta/pooled intercept, pivot TVL, training n, effective time power, base beta/tau, category raw/effective intercept, pivot multiple and shrink weight.
- `unrounded_usd`, `implied_value_usd`, `value_capped`, `confidence`, version/date/TVL. Confidence is an evidence label: high requires ≥8 category peers and observed growth/age, medium ≥3, otherwise low.

Removed redundant legacy aliases include `before_fit`, growth base/fit power, old category ratio diagnostics, intermediate base/after-growth values, repeated fit aliases, and farm `est_total_cost_before_risk_usd` / `risk_adjusted_total_cost_usd`. The cash/opportunity/risk ledger and canonical total remain available.

## Farm ledger

Six numbered steps retain protocol/category action, gas/fees, active time and duration. Setup is steps 1–3, monitoring 4–5, exit 6. Category action branches cover lending, DEX, yield/curation, RWA, staking, basis, derivatives, and supported tests for other categories. Plans remain conditional on actual asset/app/access rules; points and rewards are unverified.

```text
H = hold_days + exit_wait_days_assumed
opportunity = capital × 0.05 × H / 365
contract allowance = capital × 0.01
depeg/receipt allowance = capital × 0.01
all-in budget = entry cash + exit cash + opportunity + both allowances
```

Entry/exit cash includes gas and 25bps capital reserve each way, rounded to cents. Principal is exposure, not a spent fee; full loss is possible. Haircuts are stress allowances, not probabilities or loss limits. Opportunity and haircuts are assigned only to hold step 4, so per-step all-in amounts sum exactly to `est_total_cost_usd`. Exit duration is included in H, not counted twice.

`FARM` names every assumption: $25 test; $100/$250/$500 suggested capital by TVL; optional 2× extended tier; 8/6/4-week age windows; <−20% weekly drawdown shortens the hold to 4 weeks and check cadence to 3 days; otherwise weekly checks. Monitoring is read-only. Family profiles set action counts/time and assumed exit waits. Gas comes from the deterministic per-chain assumption table, lowest listed cost first with alphabetical ties; unlisted-chain fallback is $0.25/tx and flagged. Real bridge/onboarding/interest/funding and asset losses require quotes.

## UI, source budget and capture

The board and watchlist retain searchable category/chain/TVL/positive-growth filters, sortable values/TVL/growth/age/farm cost, immutable ranks, detail and separated trading peers. Source uses descriptive function names, ordinary indentation, one statement per line and short purpose comments. Current model/farm arithmetic is shared, not recreated in DOM code.

Detail shows raw TVL, M/G/T and final value; **raw seven-day growth %, clipped input, fixed growth weight, applied G; days without token with tracking-age/imputation caveat, time exponent and applied T**. These appear before peer evidence and the complete costed plan. Model explains formulas/priors, constants, actual LOO/baseline metrics, category fits and exclusions. Raw snapshot strings are appended as text, never inserted as HTML.

The source target is **dashboard total ≤62,500 UTF-8 bytes**. The unchanged vendor `buildDossier` also adds a Dashboard file list and Source headings/line counts/fences; it counts UTF-8 bytes, not JavaScript string length. Its canonical gate cap is **65,536 text bytes**, but tests rebuild at the stricter **64,000** cap and require identical complete dossier bytes with no `[Cut at …]` marker. Source files are copied verbatim; `tools/compact.cjs` was deleted. Space comes from retiring comparison fits/aliases, repeated views/copy and unused CSS, not minification.

The operator runs `tools/shoot.mjs` for actual captures. It retains **1440×900** and board/detail/filtered targets. Detail deterministically chooses an observed positive-growth watchlist row with |G−1|≥0.02 and |T−1|≥0.10: **Galaxy Curation**, +11.2334%, 177 observed days, G=1.0215203963×, T=1.1510894114× on this input. Capture fails if growth/day inputs or either applied factor is outside the viewport. Three lossless PNGs target 300,000–350,000 bytes each; dossier stays within 1.5 MiB. Existing screenshots must be re-shot after this revision; this work does not claim they show the new factors.

## Verification

```sh
node main.ts --input ../token-radar-01-kit/input/snapshot.json --output out
node tools/check.ts ../token-radar-01-kit/input/snapshot.json out
bash tools/determinism.sh ../token-radar-01-kit/input/snapshot.json
node tools/gate.ts out --input ../token-radar-01-kit/input/snapshot.json
# Browser functional checks where Chromium can launch; no captures:
node tools/check-ui.mjs out
# Operator screenshot capture and rebuild:
node tools/shoot.mjs --input ../token-radar-01-kit/input/snapshot.json
```

Tests cover prior direction/clipping/missing inputs, meaningful T, factor arithmetic, robust fits, held-out isolation and diagnostics, watchlist/order rules, full farm ledgers, raw-input invariance, Node/classic-browser equality, complete dossier text at 64,000 bytes, network restrictions, image integrity and seven gate rows. Determinism compares two complete output trees. Canonical generation/gate code and vendor source remain unchanged.
