# Backend → Antigravity contract

This is the frontend's complete handoff. Replace only `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js`, and add your actual captures under repository `screenshots/`. Preserve `dashboard/model.js`. It is the same deterministic classic script that Node loads to write the ranked board. There is no `farm.js`, dependency, fetch, module script, or network requirement.

## Changes

**Product-owner revision: `peer-radar-2`. Read this addendum first.** It supersedes the v1 count/value examples and the v1 multiple interpretation below. Existing function signatures and property types are retained; new properties/functions are additive. The raw RADAR_DATA shape, load order, farm-plan shape, growth factor and age factor are unchanged. The frontend files and screenshots are owned by Antigravity and were not edited for this revision. Recompute with the new model and recapture any v1 screenshots.

**Launch candidates:** `isRankable(p)` now applies all watchlist rules that are observable from the ten fields, without the TVL floor. It requires `classify(p)==='pre-token'` and no rule below. Parent-protocol metadata is unavailable; no parent relationship is invented.

| Rule | Exact predicate |
| --- | --- |
| Category | `Bridge`, `Canonical Bridge`, `Liquid Staking`, `Liquid Restaking`, `Restaked BTC`, `CEX` (the expanded `EXCLUDED_CATEGORIES`). |
| Version marker | The README's trailing version regex (verbatim below). |
| Product word | A whole word wrapped, staked or staking, case-insensitive. |
| Exchange prefix | A name beginning with any listed exchange, case-insensitive. |

```js
/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/
/\b(wrapped|staked|staking)\b/i
/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i
```

New **`RadarModel.exclusionRules(p): string[]`** returns every matching rule, not just the first. Strings identify `category: …`, `name: trailing version marker`, `name: whole word wrapped/staked/staking`, or `name: exchange prefix`. This helper is independent of token status; `isRankable` combines both. No per-slug terms or TVL cutoff are used. Every excluded record adds **`exclusion_rules: string[]`**. Pre-token exclusions have `reason = 'excluded: derivative/infrastructure of a traded token; ' + rules.join('; ')`; token-recorded records retain their identifier/no-positive-cap reason. These are conservative screening tags, not independently verified token histories. All exclusions are in `radar.excluded`, so the page can list them with the actual rule.

Current counts: **198 board records, 40/40 watchlist, 158 off-watchlist, 138 below floor; 128 trading peers; 288 token-recorded; 144 pre-token exclusions**. New **`summary.excluded_pre_token`** is 144. Existing `summary.excluded_categories` counts the 128 pre-token records matching a category rule; 16 additional pre-token records match name rules only. `radar.excluded.length` is 432. Conservation: 198 + 128 + 288 + 144 = 758. Matching rule counts overlap: category 128, version marker 11, whole-word product 20, exchange prefix 14. Never sum those overlapping rule counts.

**New valuation formula (all natural logs):**

```text
implied = round(exp(a_category) × (TVL / $100M)^β × G × T)
a_category = w × median_category(log(mcap)-log(G×T)-β×log(TVL/$100M)) + (1-w) × a_pooled
w = n/(n+4)
```

`a_pooled` is the median adjusted log-cap intercept. β is estimated with a joint Huber iteration: initialize with bounded pooled least squares; each iteration subtracts shrunk category median residual offsets, computes Huber residual weights, re-estimates the bounded pooled slope, then recenters the pooled intercept by median. Final category intercepts shrink their medians toward that pooled intercept. Extreme caps receive less slope influence; no category gets a separate slope. This lets large TVL scale sublinearly rather than forcing a 1:1 token-cap increase. Different category intercepts accommodate economically different token/receipt records without excluding inconvenient validation cases. All 128 traded positive-TVL records, including wrapper-like categories, remain in validation and training folds.

G/T are exactly the previous bounded priors. Training targets subtract `log(G×T)` so the fitted base does not double-count those factors. There is no fitted growth strength, age strength, per-name coefficient, external dataset or hand-written protocol value. Age remains a tracking proxy rather than verified time without a token.

New `CONSTANTS` entries (show alongside the existing constants):

| Key | Value | Reason |
| --- | --- | --- |
| `fit_pivot_usd` | 100000000 | Reference TVL unit; changing units alone does not change predictions. |
| `fit_beta_floor`, `fit_beta_cap` | 0, 1 | Permit flat through proportional size scaling; prevent negative or superlinear size extrapolation. |
| `fit_iterations` | 30 | Fixed deterministic robust-fit iteration budget. |
| `fit_huber_delta` | 1.345 | Robust residual-weight cutoff in scale units. |
| `fit_mad_scale` | 1.4826 | Convert median absolute residual deviation to a robust scale. |
| `fit_scale_floor` | 0.1 | Log-unit floor to prevent collapsed scales on near-exact data. |

Existing `shrink_k=4` also shrinks the fitted category intercepts. Existing `multiple_floor/cap` (0.02/5) now describe **v1 ratio diagnostics only**; they do not clamp the new effective multiple. The final positive whole-dollar value guard remains 1..100000000000000. Existing growth/time/confidence constants and all farm constants retain their roles.

**Additive calibration/breakdown fields:**

```ts
// Added to Calibration:
fit: {
  beta: number;
  pooled_log_intercept: number; // a_pooled
  pivot_tvl_usd: number;        // 100000000
  n: number;                   // all fitting peers, 128 full / 127 in LOO
};

// Added to every CategoryMultiple, including model.multiple via its existing spread:
fit: {
  raw_log_intercept: number | null; // category median adjusted log-cap intercept
  log_intercept: number;            // a_category after shrinkage
  pivot_multiple: number;           // exp(a_category) / pivot_tvl_usd
};

// Added directly to Breakdown.multiple:
size_factor: number;    // (TVL / pivot)^(beta-1)
beta: number;
pivot_tvl_usd: number;

// Added to Breakdown:
fit: {
  beta: number; pooled_log_intercept: number; pivot_tvl_usd: number; n: number;
  raw_log_intercept: number | null; log_intercept: number; pivot_multiple: number;
  shrink_weight: number; effective_multiple: number;
} | null; // null only when impliedValue is explicitly given a legacy calibration without fit
```

**UI compatibility:** `model.multiple.factor` continues to be the actual applied multiplier, now `fit.pivot_multiple × size_factor`. Thus `TVL × model.multiple.factor × growth.factor × time.factor` still exactly produces the board value before whole-dollar rounding, and `base_usd`/`after_growth_usd` remain valid. However, `model.multiple.factor` is **no longer an alias of `.multiple.multiple`**. All original raw-ratio/global-ratio/shrunk-ratio fields remain unchanged for v1 diagnostics; they are not the new fit. Label the category table's new `fit.pivot_multiple` as **“fitted multiple at $100M TVL”**, and show β/size adjustment in detail. For the formula explain `exp(fit.log_intercept)` (cap at pivot), TVL/pivot, β, G and T; raw category ratio may be shown separately as a diagnostic. Use the dynamic `METHOD.formula`, `.multiple`, and new **`METHOD.fit`** strings rather than the old v1 method prose. The model source remains a single classic script.

Current full fit: **β=0.5310042267407881**, pooled log intercept **16.65073224137006**. These are derived checks, not UI literals. E.g. doubling TVL multiplies the fitted base by `2^β`, about 1.445, rather than 2. Fitted category intercept evidence is still explicitly sparse for n=0/1/2; the evidence confidence labels have not been promoted.

**Validation additions:** every TradingPeer adds **`legacy_value_usd: number`**, the positive whole-dollar v1 prediction from that same held-out calibration's original ratio fields and unchanged G/T. `validation.legacy` adds a complete `BasicValidation` object for those v1 predictions; the existing top-level validation fields now describe v2. `validation.baseline` is unchanged (global raw-ratio × TVL). Every fold recomputes β, pooled/category intercepts, medians and age imputation with its target removed. The fitted model never sees that target's cap during its prediction.

| Same 128-record LOO evaluation | Median absolute log10 error | Median factor | Within 3× | Spearman |
| --- | ---: | ---: | ---: | ---: |
| v1 ratio model (`validation.legacy`) | 0.6954024808 | 4.9591× | 45/128 = 35.15625% | 0.3934490020 |
| v2 joint Huber, selected | 0.5820467739 | 3.8199× | 59/128 = 46.09375% | 0.3989138894 |
| Global ratio baseline | 0.7049727219 | 5.0696× | 45/128 = 35.15625% | 0.4161497436 |

The new model improves all three requested metrics over v1; the global baseline still has slightly higher rank correlation. These remain noisy cross-sectional diagnostics, not launch probabilities or independent-token validation. The same peer set contains overlapping product/token records. Model choice used the LOO comparison; **this is not an untouched final test set**.

For transparency, the small exploratory family comparison also checked pooled log-OLS (error 0.58327, within 46.09%, rank 0.39747), pooled Huber (0.58199, 42.19%, 0.39593), Theil–Sen (0.58262, 42.19%, 0.39060), shrunk local OLS slopes (0.61596, 43.75%, 0.38991), and shrunk local Huber slopes (0.60449, 42.19%, 0.40388). Joint Huber retained the pooled model's stability and better coverage; separate category slopes did not justify their extra degrees of freedom. No exhaustive parameter search or per-name terms were used. Growth/time strengths were not tuned.

The revised model must stay **≤24,000 bytes** (model.js plus farm.js if split; there is no split). Keep the complete dashboard source ≤56,000 bytes so the dossier includes it. Git commits now belong to the operator; the previous backend bundle is a historical v1 artifact, not this revision. No Git writes are required here.

## Build and load

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
node tools/gate.ts out --input ../token-radar-01-kit/input/snapshot.json
node tools/check.ts ../token-radar-01-kit/input/snapshot.json
bash tools/determinism.sh ../token-radar-01-kit/input/snapshot.json
```

`--input` also accepts a directory. Defaults: `/input/snapshot.json`; output `--output`, then `MAKEFUN_OUTPUT_DIR`, then `/output`. Builds replace only generated dashboard/screenshots/dossier paths, then write board/data. The main process never uses the wall clock, randomness or network. Node 22.18+ with native TypeScript stripping and standard library only. No package install.

Open `out/dashboard/index.html` directly with file://. This script order is required, at the end of body, **without** `type="module"`:

```html
<script src="../data.js"></script>
<script src="model.js"></script>
<script src="app.js"></script>
```

```js
const radar = window.RadarModel.buildRadar(window.RADAR_DATA);
```

Compute once and treat the result as readonly. Sort copies (`rows.slice().sort(...)`); do not modify model constants, calibration records or peer arrays. `main.ts` calls precisely this `buildRadar` and serializes `radar.rows`. Never implement another scoring or farm function in app.js. UI formatting may round, but rankings and displayed underlying values must use returned integers.

## Raw `window.RADAR_DATA`

`out/data.js` is a classic script assigning `window.RADAR_DATA`. It lives **beside** dashboard/, outside the dossier. It contains raw inputs, never precalculated rankings:

```ts
interface RadarData {
  as_of: string;             // UTC YYYY-MM-DD; this is "today"
  floor_usd: number;         // 50000000
  watchlist: string[];       // 40 slugs, ascending
  protocols: Protocol[];    // all 758, ascending by slug
}
interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;          // raw whole-dollar TVL
  change_7d: number | null; // raw PERCENT, e.g. 4 means +4%, not 0.04
  mcap_usd: number | null;  // positive, zero, negative sentinel or null, unchanged
  listed_at: string | null;// raw UTC date, never imputed in data.js
  gecko_id: string | null;
  symbol: string | null;
}
```

The source provider is DefiLlama's frozen protocol index, fetched 2026-11-14. The original source string is omitted from data.js; no external address is needed. All 758 records are necessary to reproduce age medians, calibration, exclusions and validation. The model sees exactly these inputs in Node and browser.

## Public `window.RadarModel` API

All functions are synchronous, deterministic, and do not mutate their arguments. CommonJS receives the same API through `createRequire`.

| Function / constant | Input and exact output purpose |
| --- | --- |
| `VERSION` | String `peer-radar-1`. |
| `CONSTANTS`, `METHOD`, `FARM`, `GAS`, `FAMILY`, `EXCLUDED_CATEGORIES` | Documented below. `METHOD` is a string dictionary suitable for visible methodology copy. |
| `classify(p)` | Protocol → `'trades'` if finite mcap > 0; else `'token-recorded'` if gecko_id or symbol is set; else `'pre-token'`. A zero cap is not a traded token. |
| `isRankable(p)` | True only for pre-token records outside CEX and Canonical Bridge. No name/version/watchlist exception. |
| `categoryOf(p)` | Category string, or `Uncategorized` for null/empty. |
| `ageDays(asOf, listedAt)` | Nonnegative UTC whole days; null for absent/unparseable date. Future dates clamp to zero. |
| `deriveMultiples(protocols, asOf, omitSlug?)` | Calibration object below. Omit slug from both global/category peer pools **and age imputation pools**. |
| `impliedValue(p, calibration)` | Full breakdown below; no farm plan. Category must exist in calibration. |
| `spearman(x, y)` | Equal-length numeric arrays → tie-aware average-rank correlation, null for <2 samples or zero rank variance. |
| `validatePeers(protocols, asOf)` | `{stats: Validation, peers: TradingPeer[]}`. All predictions exclude the target record; peers ordered by actual market cap descending, slug ascending for ties. |
| `familyOf(p)` | One of `lending,dex,yield,rwa,staking,basis,derivatives,other`, using category rules only. |
| `cheapestChain(p)` | `{chain,gas_per_tx_usd,known,choices}`; choices has all listed chains, sorted by assumed gas then code-unit chain name. Choice objects: `{chain,gas_per_tx_usd,known}`. If no chains, fallback `unreported chain`. |
| `buildFarmPlan(p, breakdown)` | FarmPlan below. Works for traded/excluded records too if the UI wants their details; these do not become ranked rows. |
| `buildRadar(data)` | The complete view model below; normal entry point. |

## Result of `buildRadar`

```ts
interface Radar {
  as_of: string; floor_usd: number; version: string;
  constants: typeof RadarModel.CONSTANTS;
  method: typeof RadarModel.METHOD;
  farm_assumptions: typeof RadarModel.FARM;
  gas_table: typeof RadarModel.GAS;
  calibration: Calibration;
  category_multiples: CategoryMultiple[]; // same table as calibration.categories
  validation: Validation;
  rows: RankedRow[];                     // only ranked pre-token records
  trading_peers: TradingPeer[];          // already trades; never merge into rows
  excluded: Excluded[];                  // token-recorded + excluded pre-token categories
  summary: {
    protocols: number; board: number; watchlist_total: number; watchlist_covered: number;
    off_watchlist: number; below_floor: number; trading_peers: number;
    token_recorded: number; excluded_categories: number; total_implied_value_usd: number;
  };
}
interface RankedRow extends Protocol {
  rank: number;                 // immutable model rank 1..N
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;      // actual tracking age, null remains null
  implied_value_usd: number;    // positive whole-dollar market-cap proxy
  model: Breakdown;
  flags: string[];              // missing inputs, sparse peers, product record or TVL drawdown
  farm_plan: FarmPlan;
  farm_steps: string[];         // EXACTLY farm_plan.steps.map(s => s.text)
}
interface Excluded extends Protocol {
  token_status: 'token-recorded' | 'pre-token';
  reason: string;               // identifier present/no positive cap OR excluded category
}
```

Ranks descend by whole-dollar implied value, ties by code-unit slug. A UI sort preserves the original `rank`. `off_watchlist` includes large off-watchlist records; it is **not** a synonym for `below_floor`.

Expected sealed-snapshot summary: **285 board records, 40/40 watchlist, 245 off-watchlist, 188 below floor; 128 trading peers; 288 token-recorded and 57 category exclusions**. Counts sum to 758 without overlap: 285 + 128 + 288 + 57.

The broad board intentionally includes product categories when the three token fields record no token. This brings wrapped assets and staking products into the broad ranking. Their `flags` warn that an existing asset may be tracked and an independent launch is unverified. A watchlist-only filter is useful; never silently relabel these as verified launches. Say **“records no token”**, never “has no token”. No ranking uses a name, symbol or watchlist boost.

## Calibration table and peers used

```ts
interface Calibration {
  as_of: string;
  omitted_slug: string | null;
  global: {
    n: number; log_median: number; raw_multiple: number; multiple: number;
    peer_slugs: string[]; age_sample_n: number; median_age_days: number | null;
  };
  categories: CategoryMultiple[]; // all 53 snapshot categories, alphabetical
}
interface CategoryMultiple {
  category: string;
  n: number;                    // positive-cap, positive-TVL traded records in category
  raw_log_median: number | null; // median of natural-log mcap/TVL; null for no peers
  raw_multiple: number | null;   // exp(raw_log_median); geometric midpoint for even n
  shrink_weight: number;         // n/(n+4)
  shrunk_log_multiple: number;   // w*raw_log_median + (1-w)*global.log_median
  shrunk_multiple: number;       // exp(shrunk_log_multiple), before clamp
  multiple: number;              // clamp(shrunk_multiple, 0.02, 5)
  clamped: boolean;
  source: 'category-shrunk' | 'global-fallback';
  peer_slugs: string[];           // category peers, ascending slug
  age_sample_n: number;          // ALL known-age records in category, not just traded
  median_age_days: number | null;
}
```

Every traded positive-TVL record participates, including CEX/Canonical Bridge for calibration. Excluded-category **ranking** rules do not remove peers. Missing category peers use the global median with w=0. A single peer gets only 20% log weight; 4 peers get 50%. This limits outlier influence while preserving sector evidence. The 0.02–5 ratio band is a guard against economically extreme projections, not an optimized forecast interval. Global age samples include all known-age protocols. No peers at all is an explicit model error.

Current global median: **0.2136179968867636×** across 128 peers. Examples: Risk Curators n=1, raw 2.9747247664× → shrunk 0.3617425773×; Lending n=15, raw 0.1323946556× → 0.1464235582×; RWA n=9, raw 0.2747800449× → 0.2542961887×. These figures are regression checks, never hardcode them into the UI.

Category peers resolve by slug from raw protocols or radar.trading_peers. `calibration.global.peer_slugs` identifies the entire global prior. For a **traded peer detail**, remove its `model.multiple.omitted_slug` from that global list; its breakdown's `peer_slugs` already excludes itself.

## Full valuation breakdown

```ts
interface Breakdown {
  version: string; as_of: string; tvl_usd: number;
  multiple: CategoryMultiple & {
    global_n: number; global_log_median: number; global_raw_multiple: number;
    factor: number;            // alias of final CategoryMultiple.multiple
    omitted_slug: string | null;
  };
  growth: {
    raw_pct: number | null; used_pct: number;
    missing: boolean; clamped: boolean; factor: number;
  };
  time: {
    listed_at: string | null; age_days: number | null; used_days: number;
    imputed: boolean; source: 'listed_at'|'category-median'|'global-median'|'fallback';
    age_sample_n: number; // 1 if observed; imputation sample count otherwise
    rise: number; fade: number; factor: number;
  };
  base_usd: number;             // TVL * multiple.factor
  after_growth_usd: number;     // base_usd * growth.factor
  unrounded_usd: number;        // after_growth_usd * time.factor
  implied_value_usd: number;    // rounded, bounded 1..100000000000000
  value_capped: boolean;        // true only when upper value guard applied
  confidence: 'high'|'medium'|'low'; // evidence label, not a statistical confidence level
}
```

Do not multiply factors after UI rounding; show `model.implied_value_usd` as the final number. Formula: **TVL × M × G × T**, rounded to a whole dollar. Unit: **implied token market cap**, not FDV. Token supply and allocation are absent, so no price or expected airdrop can be inferred.

`CONSTANTS` values and reasoning (show visibly in the page's methodology):

| Constant | Value | Role |
| --- | --- | --- |
| `shrink_k` | 4 | Four pseudo-observations of global log-median evidence. |
| `multiple_floor`, `multiple_cap` | 0.02, 5 | Bound the final mcap/TVL multiple. |
| `growth_floor_pct`, `growth_cap_pct`, `growth_power` | -50, 100, 0.5 | `G=(1+clamp(change_7d,-50,100)/100)^0.5`; range √0.5..√2; missing→1, flagged. Avoid extrapolating a volatile week. |
| `time_floor`, `time_rise`, `time_rise_days` | 0.80, 0.35, 365 | Tracking persistence earns a bounded one-year rise. |
| `time_fade`, `time_fade_start_days`, `time_fade_days` | 0.15, 730, 730 | Long-standing records may never launch; fade after two years toward a neutral factor. |
| `fallback_age_days` | 365 | Used only if neither category nor global has known ages; flagged. |
| `value_cap_usd` | 100000000000000 | Gate's safety limit; not active on this snapshot. |
| `validation_tolerance` | 3 | Within-3× diagnostic, not an uncertainty promise. |
| `confidence_high_n`, `confidence_medium_n` | 8, 3 | High requires ≥8 category peers plus observed growth/age; medium requires ≥3 peers; else low. |

Time curve:

```text
rise = 0.35 * (1 - exp(-d/365))
fade = 0.15 * (1 - exp(-max(d-730,0)/730))
T = 0.80 + rise - fade
```

At 0/365/730/1095 days: approximately 0.800/1.021/1.103/1.074. It peaks at 730 and tends to 1.000 for very old records. Listing age is a proxy for persistent TVL, **not verified time without a token**. Null dates use the category median known age, then global median, then fallback. Median ages may have half days; do not silently turn imputed dates into real listing dates.

## Leave-one-out validation and Trading peers

```ts
interface BasicValidation {
  n: number;
  median_abs_log10_error: number | null;
  median_error_factor: number | null; // 10 ** median_abs_log10_error
  within_3x_count: number;
  within_3x_share: number | null;     // 0..1, multiply by 100 for percent
  spearman: number | null;           // average ranks for ties, then Pearson of ranks
}
interface Validation extends BasicValidation {
  baseline: BasicValidation;         // held-out global multiple * TVL; no G/T/category
  missing_age_n: number; missing_growth_n: number;
  note: string;
}
interface TradingPeer extends Protocol {
  token_status: 'trades';
  model: Breakdown;                 // prediction excludes this record
  predicted_value_usd: number;      // alias model.implied_value_usd
  predicted_to_market: number;      // prediction / raw mcap_usd
  abs_log10_error: number;
  within_3x: boolean;
  baseline_value_usd: number;
}
```

Use the label **Trading peers · already trades** and show actual `mcap_usd` beside `predicted_value_usd`, explicitly **leave-one-out**. Do not assign model ranks or mix these with rows. No `farm_plan` is attached to TradingPeer; call `buildFarmPlan(peer, peer.model)` for a plan if its detail view needs one.

Current diagnostics (128 records): median |log10 error| **0.6954024808**, median error factor **4.9591×**, within 3× **45/128 = 35.15625%**, Spearman **0.3934490020**; 33 ages imputed, 0 growth values missing. Baseline: error **0.7049727219**, factor **5.0696×**, within 3× **35.15625%**, Spearman **0.4161497436**. The category model modestly improves median magnitude error and does not improve every metric. Display the evidence honestly: this is a rough relative valuation model, not a calibrated forecast. Shared tokens/product records limit independence; the data does not supply a reliable parent-token map or historical launch outcomes.

## Farm plans

```ts
interface FarmPlan {
  family: 'lending'|'dex'|'yield'|'rwa'|'staking'|'basis'|'derivatives'|'other';
  chain: string; gas_per_tx_usd: number; gas_known: boolean;
  chain_choices: {chain:string;gas_per_tx_usd:number;known:boolean}[];
  capital_usd: number;
  capital_tiers: number[];           // [test, standard/suggested, extended]
  est_setup_cost_usd: number;        // entry gas + fee/slippage reserve; excludes capital
  est_exit_cost_usd: number;         // exit gas + reserve
  gas_total_usd: number; fee_buffer_total_usd: number;
  opportunity_cost_usd: number;      // capital * .05 * (hold_days + exit_wait_days)/365
  est_total_cost_usd: number;        // setup + exit + opportunity; principal is NOT an expense
  capital_at_risk_usd: number;       // full suggested capital, asset losses unpriced
  setup_minutes: number;
  hold_weeks: number; hold_days: number;
  exit_wait_days_assumed: number;    // budget assumption, not verified lockup
  check_every_days: number; check_count: number; monitoring_minutes: number;
  total_active_minutes: number;     // setup + monitoring + 10 minute exit
  eligibility: 'unverified';
  assumptions: string;
  steps: FarmStep[];                // exactly six, numbered
}
interface FarmStep {
  number: number; phase: 'setup'|'monitor'|'exit';
  title: string; action: string;
  transactions: number; gas_usd: number; fee_buffer_usd: number;
  est_cost_usd: number; opportunity_cost_usd: number;
  active_minutes: number; duration_days: number;
  text: string;                    // board's complete step incl. cost and time
}
```

Render either `step.text` in full or all of `action`, costs and time in separate columns. A list of actions alone loses required information. Setup totals cover steps 1–3; monitoring covers 4–5; exit is step 6. `duration_days` in step 4 is the hold period, and step 6 is the additional assumed exit wait. Opportunity cost is carried **only in step 4**, including that exit wait; do not count it twice. Monetary totals round to cents; the gas assumption may be sub-cent (Algorand 0.001).

`FARM` constants (show assumptions beside plan totals):

| Keys | Values / derivation |
| --- | --- |
| `test_capital_usd` | 25; small route test before a larger commitment. |
| `small_capital_usd`, `medium_capital_usd`, `large_capital_usd` | 100 / 250 / 500. TVL thresholds `medium_tvl_usd=50000000`, `large_tvl_usd=1000000000`; coarse capacity tiers, not safety scores. |
| `extended_capital_factor` | 2 × suggested capital; optional tier, not required for eligibility. |
| `max_ltv` | 0.20; optional borrowing only when verified rules require it. Quote interest separately. |
| `young_days`, `mature_days` | 180 / 730; use model's observed or flagged imputed days. |
| `young_hold_weeks`, `normal_hold_weeks`, `mature_hold_weeks` | 8 / 6 / 4; planning windows, no claimed qualification period. |
| `stress_growth_pct` | -20; change_7d below this shortens hold to 4 weeks and check cadence to 3 days. |
| `check_days`, `stress_check_days`, `check_minutes` | 7 / 3 / 5; read-only checks, no recurring transaction budget. Check count = ceil(hold days / cadence). |
| `opportunity_apr` | 0.05 simple APR forgone, not a claim about protocol yield. Applies through assumed exit wait. |
| `fee_buffer_bps` | 25 bps of suggested capital at each of entry and exit. Allowance for unknown fees/slippage; not a measured fee. |
| `fallback_gas_usd` | 0.25 for chains absent from GAS. `gas_known=false` must be flagged as an assumed fallback. |
| `qualify_minutes`, `fund_minutes`, `risk_review_minutes`, `exit_minutes` | 8 / 5 / 5 / 10; action time from FAMILY below. |

Gas table: Ethereum **5.00** (budget range $2–8); Bitcoin **2.00**; Tron **1.00**; Solana/Sui/Aptos/Stellar/Ripple/Near/Flare/xDai/Celo/Noble **0.01**; Algorand **0.001**; TON **0.03**; Polygon/Monad/Sonic **0.02**; Avalanche **0.10**; Base/Arbitrum/Optimism/zkSync Era/Linea/Scroll/Ink/Unichain/Mantle/Binance/Berachain/Hyperliquid L1/Plume Mainnet/Bittensor/CORE/BSquared/Mezo/Starknet **0.05**; all unlisted **0.25**. These are assumed USD per transaction, not quotes. All equal-cost ties break alphabetically by code unit. A listed chain can be indexed without a usable retail app; confirm before following the plan. Funds are assumed already on-chain; bridge/onboarding/rent/interest/funding/asset losses are excluded and require a quote.

`FAMILY[family]` is `[entry_action_tx, action_minutes, exit_tx, assumed_exit_wait_days]`:

| Family | Tuple | Category matching and action |
| --- | --- | --- |
| rwa | [2,25,3,14] | `rwa`, `uncollateral`, `otc`: eligible subscription, minimum/redemption checks, skip inaccessible route. |
| derivatives | [3,22,3,0] | `derivative`, `options` (including options vaults): supported passive vault or at most $25 unlevered notional only if required; funding unpriced. |
| staking | [2,18,3,7] | `collateral markets`, `staking`, `restaked`: collateral stake/restake; slashing/unbonding. |
| lending | [3,18,3,0] | `lend`, `cdp`, `collateral management`: supply supported collateral; optional borrowing capped at 20% LTV. |
| dex | [4,20,3,0] | `dex`, `amm`, `liquidity manager`: 50/50 supported pool, broad range, price-impact and divergence-loss checks. |
| basis | [3,20,3,7] | `basis`, `stable`, `cedefi`, `synthetics`, `reserve currency`: supported mint/receipt and conditional stake; backing/depeg. |
| yield | [2,15,3,3] | `yield`, `farm`, `curator`, `allocator`, `indexes`, `governance incentives`, `dor`: public vault, accepted asset, receipt shares and strategy/exit queue. |
| other | [2,18,2,1] | Remaining categories. Specific branches for bridge/BTC transfer tests, payment channels, prediction stakes, insurance underwriting, privacy exit tests, or a native-chain action. No generic USDC deposit on unsupported chains. |

Matching is case-insensitive and evaluated in the table's order. One funding transaction is added to every entry-action count; exit includes withdrawal/redeem/approval cleanup allowances. Actual transaction counts may differ. No points multiplier, reward allocation, asset support, minimum subscription, pool or lockup is invented from outside the snapshot. Steps are conditional category-derived plans and must retain their access/eligibility qualifications.

## UI obligations and source budget

Show the ranking, watchlist coverage and snapshot date first. Include searchable name/category/chain filters, watchlist toggle, sortable value/TVL/growth/age/cost columns, and protocol detail. Keep Trading peers and token-recorded exclusions separate. A detail should show TVL, raw 7d %, observed vs imputed tracking age, **M/G/T**, peer count, raw/global/shrunk/clamped multiple derivation, peer list, confidence/flags, six complete farm steps and totals. Show the category-multiple table, formula/constants and leave-one-out diagnostics somewhere accessible on the page.

The shared model is **21,963 bytes**; keep the other dashboard sources together below about **34,000 bytes**, for total source ≤56,000. Dossier text is capped at 65,536 bytes including file listings/fences. All model/plan code already lives in the dossier-visible model.js. Do not add a vendored library/font or duplicate derived rows in dashboard/. Use local/system assets and no external addresses in attributes, styles or import specifiers. Use textContent for raw names/categories.

Place **3 actual screenshots** in repository `screenshots/`, preferably `1-board.png`, `2-detail.png`, `3-filtered.png` (3–4 PNG/JPEG allowed). Each: long side ≤1440, short side ≥800, ≤512 KiB. Suggested viewport 1440×1000; target ≤300–350 KB each and combined image bytes ≤~1 MB for the 1.5 MiB dossier. Screenshots must match the live page and computed data. No starter screenshots were reused.

Re-run main after all frontend changes/screenshots to refresh out/dashboard and the canonical vendor dossier, then gate and determinism. The gate strictly reports missing images and missing dossier as failures. `buildDossier` **refuses zero images**, so a screenshot-free backend handoff cannot truthfully pass dossier_matches. Main deliberately leaves it pending and removes stale dossiers; it does not fabricate an image or relax the gate. Once screenshots exist, it writes dossier.json with the unchanged `vendor/makefun-board.ts`. The JPEG check validates full marker/entropy-stream structure but is not a pixel decoder; PNG validation checks CRC, deflate and scanlines. This tool does not replace the sealed scorer.

No remote repository, deployment, push or submission has been made. Root README/LICENSE are intentionally deferred.

The current workspace mounts `.git` read-only: normal `git add` cannot create its index lock. A real local backend commit is therefore preserved in **`out/backend-commit.bundle`**, verified with `git bundle verify`, using separate writable Git metadata in `/tmp`. The protected repository's HEAD/index remain unchanged. The bundle contains all 15 authored/vendored source files; generated board/data are intentionally ignored. Preserve the bundle for transfer, or import it after repository metadata becomes writable. No remote is involved.
