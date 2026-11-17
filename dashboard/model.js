(function (root) {
'use strict';
const VERSION='peer-radar-2';
const C=Object.freeze({
	shrink_k: 4,multiple_floor: 0.02,multiple_cap: 5,
	growth_floor_pct: -50,growth_cap_pct: 100,growth_power: 0.5,
	time_floor: 0.80,time_rise: 0.35,time_rise_days: 365,
	time_fade: 0.15,time_fade_start_days: 730,time_fade_days: 730,
	fallback_age_days: 365,value_cap_usd: 100000000000000,
	validation_tolerance: 3,confidence_high_n: 8,confidence_medium_n: 3,
	fit_pivot_usd: 100000000,fit_beta_floor: 0,fit_beta_cap: 1,
	fit_iterations: 30,fit_huber_delta: 1.345,fit_mad_scale: 1.4826,fit_scale_floor: 0.1
});
const METHOD=Object.freeze({
	formula: 'round(exp(a_category) × (TVL/$100M)^β × G × T) = round(TVL × M_effective × G × T)',
	multiple: 'M_effective=exp(a_category)/$100M × (TVL/$100M)^(β-1). Raw ratio fields are v1 diagnostics; fitted intercepts use w=n/(n+4).',
	fit: 'Joint Huber on log(mcap)-log(G×T); pooled β∈[0,1],median category intercepts shrunk to pooled. 30 iterations; δ=1.345,MAD×1.4826,scale≥0.1. G/T unchanged priors.',
	growth: 'G=(1+clamp(change_7d,-50,100)/100)^0.5; missing→1,flagged.',
	time: 'T=.80+.35(1-exp(-d/365))-.15(1-exp(-max(d-730,0)/730)); peak 1.103 at 730d,fades to 1: old records may never launch.',
	missing_age: 'Missing date→category median age→global median→365d; flagged.',
	validation: 'Refit without target,including age pools/category priors. Report median |log10(predicted/market)|,within-3× and tie-aware Spearman.',
	limits: 'Market-cap proxy,not price/allocation/launch odds. Supply/rewards unknown; product TVL may overlap.',
	eligibility: 'Records no token≠token absent. Apply watchlist category/name exclusions without TVL floor; parent metadata is unavailable.',
	confidence: 'Evidence: high≥8 peers+known growth/age; medium≥3 peers; else low. Not launch odds.'
});
const FARM=Object.freeze({
	opportunity_apr: 0.05,fee_buffer_bps: 25,fallback_gas_usd: 0.25,
	test_capital_usd: 25,small_capital_usd: 100,medium_capital_usd: 250,
	large_capital_usd: 500,medium_tvl_usd: 50000000,large_tvl_usd: 1000000000,
	young_days: 180,mature_days: 730,young_hold_weeks: 8,
	normal_hold_weeks: 6,mature_hold_weeks: 4,stress_growth_pct: -20,
	check_days: 7,stress_check_days: 3,check_minutes: 5,
	qualify_minutes: 8,fund_minutes: 5,risk_review_minutes: 5,
	exit_minutes: 10,max_ltv: 0.20,extended_capital_factor: 2,
	assumptions: 'Budget: gas/tx,25bps entry/exit,5% APR forgone. Start on-chain. Bridge/rent/interest/funding/losses unpriced; verify minimums/access/rewards.'
});
// Assumed USD/tx: Ethereum $5 ($2–8),L2 $0.05,Solana $0.01.
const GAS=Object.freeze({
	Ethereum: 5,Bitcoin: 2,Tron: 1,Solana: 0.01,Sui: 0.01,Aptos: 0.01,
	Stellar: 0.01,Algorand: 0.001,Ripple: 0.01,Near: 0.01,TON: 0.03,
	Base: 0.05,Arbitrum: 0.05,Optimism: 0.05,'zkSync Era': 0.05,
	Linea: 0.05,Scroll: 0.05,Ink: 0.05,Unichain: 0.05,Mantle: 0.05,
	Binance: 0.05,Polygon: 0.02,Avalanche: 0.10,Monad: 0.02,
	Flare: 0.01,xDai: 0.01,Celo: 0.01,Sonic: 0.02,Berachain: 0.05,
	'Hyperliquid L1': 0.05,'Plume Mainnet': 0.05,Bittensor: 0.05,
	CORE: 0.05,BSquared: 0.05,Mezo: 0.05,Noble: 0.01,Starknet: 0.05
});
const EXCLUDED_CATEGORIES=Object.freeze(['Bridge','Canonical Bridge','Liquid Staking','Liquid Restaking','Restaked BTC','CEX']);
const FAMILY=Object.freeze({
	lending: [3,18,3,0],dex: [4,20,3,0],yield: [2,15,3,3],
	rwa: [2,25,3,14],staking: [2,18,3,7],basis: [3,20,3,7],
	derivatives: [3,22,3,0],other: [2,18,2,1]
}); // [action tx,minutes,exit tx,assumed wait days]
const cmp=(a,b)=>a < b ? -1 : a > b ? 1 : 0;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const cents=n=>Math.round(n*100)/100;
const median=values=>{
	const a=values.slice().sort((a,b)=>a-b),n=a.length;
	return n ? (a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2 : null;
};
const categoryOf=p=>p.category || 'Uncategorized';
function classify(p) {
	if (Number.isFinite(p.mcap_usd) && p.mcap_usd > 0) return 'trades';
	return p.gecko_id || p.symbol ? 'token-recorded' : 'pre-token';
}
function exclusionRules(p) {
	return [EXCLUDED_CATEGORIES.includes(p.category) && 'category: '+p.category,
		/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name) && 'name: trailing version marker',
		/\b(wrapped|staked|staking)\b/i.test(p.name) && 'name: whole word wrapped/staked/staking',
		/^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i.test(p.name) && 'name: exchange prefix'].filter(Boolean);
}
function isRankable(p) { return classify(p)==='pre-token' && !exclusionRules(p).length; }
function ageDays(asOf,listedAt) {
	if (!listedAt) return null;
	const a=Date.parse(asOf+'T00:00:00Z'),b=Date.parse(listedAt+'T00:00:00Z');
	return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0,Math.floor((a-b)/86400000)) : null;
}
// Held-out record excluded from priors and ages.
function deriveMultiples(protocols,asOf,omitSlug) {
	const all=protocols.filter(p=>p.slug!==omitSlug).slice().sort((a,b)=>cmp(a.slug,b.slug));
	const peers=all.filter(p=>classify(p)==='trades' && p.tvl_usd > 0);
	if (!peers.length) throw new Error('At least one positive-cap,positive-TVL peer is required');
	const logMedian=median(peers.map(p=>Math.log(p.mcap_usd/p.tvl_usd)));
	const ages=all.map(p=>ageDays(asOf,p.listed_at)).filter(d=>d!==null);
	const global={
		n: peers.length,log_median: logMedian,raw_multiple: Math.exp(logMedian),
		multiple: clamp(Math.exp(logMedian),C.multiple_floor,C.multiple_cap),
		peer_slugs: peers.map(p=>p.slug),age_sample_n: ages.length,
		median_age_days: median(ages)
	};
	const categories=Array.from(new Set(protocols.map(categoryOf))).sort(cmp).map(category=>{
		const group=peers.filter(p=>categoryOf(p)===category);
		const knownAges=all.filter(p=>categoryOf(p)===category).map(p=>ageDays(asOf,p.listed_at)).filter(d=>d!==null);
		const n=group.length,w=n/(n+C.shrink_k);
		const rawLog=median(group.map(p=>Math.log(p.mcap_usd/p.tvl_usd)));
		const shrunkLog=w*(rawLog===null ? logMedian : rawLog)+(1-w)*logMedian;
		const unbounded=Math.exp(shrunkLog);
		const multiple=clamp(unbounded,C.multiple_floor,C.multiple_cap);
		return {
			category,n,raw_log_median: rawLog,raw_multiple: rawLog===null ? null : Math.exp(rawLog),
			shrink_weight: w,shrunk_log_multiple: shrunkLog,shrunk_multiple: unbounded,
			multiple,clamped: multiple!==unbounded,source: n ? 'category-shrunk' : 'global-fallback',
			peer_slugs: group.map(p=>p.slug),age_sample_n: knownAges.length,
			median_age_days: median(knownAges)
		};
	});
	const cal={ as_of: asOf,omitted_slug: omitSlug || null,global,categories };
	cal.fit=fitLogModel(peers,cal);
	return cal;
}
function factors(p,cal) {
	const c=C,cat=cal.categories.find(r=>r.category===categoryOf(p));
	if (!cat) throw new Error('Category absent from cal');
	const age=ageDays(cal.as_of,p.listed_at);
	const ageSource=age!==null ? 'listed_at' : cat.median_age_days!==null ? 'category-median' : cal.global.median_age_days!==null ? 'global-median' : 'fallback';
	const d=age!==null ? age : cat.median_age_days!==null ? cat.median_age_days : cal.global.median_age_days!==null ? cal.global.median_age_days : c.fallback_age_days;
	const missingGrowth=!Number.isFinite(p.change_7d);
	const change=clamp(missingGrowth ? 0 : p.change_7d,c.growth_floor_pct,c.growth_cap_pct);
	const growth=Math.pow(1+change/100,c.growth_power);
	const rise=c.time_rise*(1-Math.exp(-d/c.time_rise_days));
	const fade=c.time_fade*(1-Math.exp(-Math.max(0,d-c.time_fade_start_days)/c.time_fade_days));
	const time=c.time_floor+rise-fade;
	return {
		cat,
		growth: { raw_pct: p.change_7d,used_pct: change,missing: missingGrowth,clamped: !missingGrowth && change!==p.change_7d,factor: growth },
		time: { listed_at: p.listed_at,age_days: age,used_days: d,imputed: age===null,
			source: ageSource,age_sample_n: age!==null ? 1 : cat.median_age_days!==null ? cat.age_sample_n : cal.global.age_sample_n,
			rise,fade,factor: time }
	};
}
function fitLogModel(peers,cal) {
	const pts=peers.map(p=>{ const f=factors(p,cal); return {
		x: Math.log(p.tvl_usd/C.fit_pivot_usd),y: Math.log(p.mcap_usd)-Math.log(f.growth.factor*f.time.factor),category: categoryOf(p) }; });
	const groups=cal.categories.map(cat=>pts.filter(p=>p.category===cat.category));
	function slope(a,weights) {
		let sw=0,sx=0,sy=0,xx=0,xy=0;
		a.forEach((p,i)=>{ const w=weights ? weights[i] : 1; sw+=w; sx+=w*p.x; sy+=w*p.y; });
		a.forEach((p,i)=>{ const w=weights ? weights[i] : 1,x=p.x-sx/sw; xx+=w*x*x; xy+=w*x*(p.y-sy/sw); });
		return xx ? clamp(xy/xx,C.fit_beta_floor,C.fit_beta_cap) : 0;
	}
	let beta=slope(pts),alpha=median(pts.map(p=>p.y-beta*p.x));
	for (let k=0; k<C.fit_iterations; k++) {
		const offsets=groups.map(g=>g.length ? g.length/(g.length+C.shrink_k)*median(g.map(p=>p.y-alpha-beta*p.x)) : 0);
		const adjusted=pts.map(p=>({ x:p.x,y:p.y-offsets[cal.categories.findIndex(c=>c.category===p.category)] }));
		const r=adjusted.map(p=>p.y-alpha-beta*p.x),mid=median(r);
		const scale=Math.max(C.fit_scale_floor,C.fit_mad_scale*median(r.map(v=>Math.abs(v-mid))));
		beta=slope(adjusted,r.map(v=>Math.min(1,C.fit_huber_delta*scale/Math.max(Math.abs(v),Number.EPSILON))));
		alpha=median(pts.map(p=>p.y-beta*p.x));
	}
	cal.categories.forEach((cat,i)=>{
		const raw=median(groups[i].map(p=>p.y-beta*p.x)),w=cat.shrink_weight;
		const intercept=w*(raw===null ? alpha : raw)+(1-w)*alpha;
		cat.fit={ raw_log_intercept:raw,log_intercept:intercept,pivot_multiple:Math.exp(intercept)/C.fit_pivot_usd };
	});
	return { beta,pooled_log_intercept:alpha,pivot_tvl_usd:C.fit_pivot_usd,n:pts.length };
}
function impliedValue(p,cal) {
	const {cat,growth,time}=factors(p,cal);
	const size=cal.fit ? Math.pow(p.tvl_usd/C.fit_pivot_usd,cal.fit.beta-1) : 1;
	const multiple=cal.fit ? cat.fit.pivot_multiple*size : cat.multiple;
	const base=p.tvl_usd*multiple,afterGrowth=base*growth.factor,value=afterGrowth*time.factor;
	const implied=clamp(Math.round(value),1,C.value_cap_usd);
	return {
		version: VERSION,as_of:cal.as_of,tvl_usd:p.tvl_usd,
		multiple: { ...cat,global_n:cal.global.n,global_log_median:cal.global.log_median,
			global_raw_multiple:cal.global.raw_multiple,factor:multiple,omitted_slug:cal.omitted_slug,
			size_factor:size,beta:cal.fit ? cal.fit.beta : 1,pivot_tvl_usd:C.fit_pivot_usd },
		growth,time,
		fit:cal.fit ? { ...cal.fit,...cat.fit,shrink_weight:cat.shrink_weight,effective_multiple:multiple } : null,
		base_usd: base,after_growth_usd: afterGrowth,unrounded_usd: value,
		implied_value_usd: implied,value_capped: implied!==Math.max(1,Math.round(value)),
		confidence: cat.n >= C.confidence_high_n && !time.imputed && !growth.missing ? 'high' : cat.n >= C.confidence_medium_n ? 'medium' : 'low'
	};
}
// Spearman: Pearson of average ranks for ties.
function spearman(x,y) {
	function ranks(a) {
		const order=a.map((v,i)=>({ v,i })).sort((a,b)=>a.v-b.v || a.i-b.i),r=[];
		for (let i=0; i < order.length;) {
			let j=i+1;
			while (j < order.length && order[j].v===order[i].v) j++;
			for (let k=i; k < j; k++) r[order[k].i]=(i+1+j)/2;
			i=j;
		}
		return r;
	}
	if (x.length < 2 || x.length!==y.length) return null;
	const a=ranks(x),b=ranks(y),mid=(a.length+1)/2;
	let cross=0,aa=0,bb=0;
	a.forEach((v,i)=>{ cross += (v-mid)*(b[i]-mid); aa += (v-mid) ** 2; bb += (b[i]-mid) ** 2; });
	return aa && bb ? cross/Math.sqrt(aa*bb) : null;
}
function validationStats(peers,field) {
	const errors=peers.map(p=>Math.abs(Math.log10(p[field]/p.mcap_usd)));
	const error=median(errors),n=peers.length;
	const within=errors.filter(e=>e <= Math.log10(C.validation_tolerance)).length;
	return { n,median_abs_log10_error: error,median_error_factor: error===null ? null : 10 ** error,
		within_3x_count: within,within_3x_share: n ? within/n : null,
		spearman: spearman(peers.map(p=>p[field]),peers.map(p=>p.mcap_usd)) };
}
function validatePeers(protocols,asOf) {
	const peers=protocols.filter(p=>classify(p)==='trades' && p.tvl_usd > 0).map(p=>{
		const cal=deriveMultiples(protocols,asOf,p.slug),model=impliedValue(p,cal);
		const ratio=model.implied_value_usd/p.mcap_usd;
		return { ...p,token_status: 'trades',model,predicted_value_usd: model.implied_value_usd,
			predicted_to_market: ratio,abs_log10_error: Math.abs(Math.log10(ratio)),
			within_3x: ratio >= 1/C.validation_tolerance && ratio <= C.validation_tolerance,
			legacy_value_usd: clamp(Math.round(p.tvl_usd*model.multiple.multiple*model.growth.factor*model.time.factor),1,C.value_cap_usd),
			baseline_value_usd: Math.max(1,Math.round(p.tvl_usd*cal.global.multiple)) };
	}).sort((a,b)=>b.mcap_usd-a.mcap_usd || cmp(a.slug,b.slug));
	return { stats: { ...validationStats(peers,'predicted_value_usd'),baseline: validationStats(peers,'baseline_value_usd'),
		legacy:validationStats(peers,'legacy_value_usd'),
		missing_age_n: peers.filter(p=>p.model.time.imputed).length,
		missing_growth_n: peers.filter(p=>p.model.growth.missing).length,
		note: METHOD.validation+' Model selection used LOO; not untouched test data or launch evidence.' },peers };
}
function familyOf(p) {
	const c=categoryOf(p).toLowerCase();
	if (/rwa|uncollateral|otc/.test(c)) return 'rwa';
	if (/derivative|options/.test(c)) return 'derivatives';
	if (/collateral markets|staking|restaked/.test(c)) return 'staking';
	if (/lend|cdp|collateral management/.test(c)) return 'lending';
	if (/dex|amm|liquidity manager/.test(c)) return 'dex';
	if (/basis|stable|cedefi|synthetics|reserve currency/.test(c)) return 'basis';
	if (/yield|farm|curator|allocator|indexes|governance incentives|dor/.test(c)) return 'yield';
	return 'other';
}
function cheapestChain(p) {
	const choices=p.chains.map(chain=>({ chain,gas_per_tx_usd: GAS[chain]===undefined ? FARM.fallback_gas_usd : GAS[chain],known: GAS[chain]!==undefined }))
		.sort((a,b)=>a.gas_per_tx_usd-b.gas_per_tx_usd || cmp(a.chain,b.chain));
	return { ...(choices[0] || { chain: 'unreported chain',gas_per_tx_usd: FARM.fallback_gas_usd,known: false }),choices };
}
const money=n=>'$'+n.toFixed(n > 0 && n < 0.01 ? 3 : 2);
function compactUsd(n) { return n >= 1e9 ? '$'+(n/1e9).toFixed(2)+'B' : '$'+(n/1e6).toFixed(2)+'M'; }
function farmAction(p,family,capital,chain) {
	const amount=money(capital),name=p.name;
	const actions={
		lending: `Supply ${amount} supported collateral to ${name} on ${chain}; approve exact amount. Borrow only if required,LTV≤${FARM.max_ltv*100}%; check liquidation/interest first.`,
		dex: `LP ${amount} 50/50 in ${name}'s deepest accessible pool on ${chain}; broad range,preview impact/fees. Skip if no public LP route.`,
		yield: `Deposit ${amount} accepted asset in a public ${name} vault on ${chain} (curator-managed if applicable); keep shares,check strategy/exit queue.`,
		rwa: `Subscribe ${amount} to ${name} on ${chain}; verify investor access,minimum and redemption dates. Keep receipt; skip if ineligible/over budget.`,
		staking: `Stake/restake ${amount} supported collateral through ${name} on ${chain}. Record receipt/slashing/unbonding; no borrowing against receipt.`,
		basis: `Mint/acquire ${amount} ${name} stable/basis receipt on ${chain}; stake only if required. Check backing/spread; no leverage/loops.`,
		derivatives: `Fund ${name} on ${chain} with ${amount} margin; documented vault or ≤$${FARM.test_capital_usd} unlevered notional only if required. Quote funding; no wash volume.`
	};
	if (actions[family]) return actions[family];
	const cat=categoryOf(p).toLowerCase();
	if (/bridge|btc/.test(cat)) return `Test $${FARM.test_capital_usd} ${name} transfer/redemption on ${chain}; receipt cap ${amount}. Quote bridge fees; wrappers prove no launch/points eligibility.`;
	if (/payment/.test(cat)) return `Test $${FARM.test_capital_usd} in ${name}'s payment/channel route on ${chain}. Reserve ≤${amount} if supported; check close procedure/routing fees.`;
	if (/prediction/.test(cat)) return `At ${name} on ${chain},budget ${amount},risk ≤$${FARM.test_capital_usd} on one outcome if rules count it; record settlement. Stake can be lost.`;
	if (/insurance/.test(cat)) return `Underwrite ≤${amount} in ${name}'s public vault on ${chain} if accessible. Check claim liability/lockup; policy premiums are separate.`;
	if (/privacy/.test(cat)) return `Test $${FARM.test_capital_usd} deposit/exit at ${name} on ${chain}; keep recovery receipt. Cap ${amount} after verifying exit/eligibility.`;
	return `Test $${FARM.test_capital_usd} native action at ${name} on ${chain}; for chains,transfer between your wallets. Cap documented earning route at ${amount},else skip.`;
}
function buildFarmPlan(p,model) {
	const f=FARM,family=familyOf(p),chain=cheapestChain(p),profile=FAMILY[family];
	const capital=p.tvl_usd >= f.large_tvl_usd ? f.large_capital_usd : p.tvl_usd >= f.medium_tvl_usd ? f.medium_capital_usd : f.small_capital_usd;
	const age=model.time.used_days,stressed=Number.isFinite(p.change_7d) && p.change_7d < f.stress_growth_pct;
	const weeks=stressed ? f.mature_hold_weeks : age < f.young_days ? f.young_hold_weeks : age < f.mature_days ? f.normal_hold_weeks : f.mature_hold_weeks;
	const hold=weeks*7,cadence=stressed ? f.stress_check_days : f.check_days;
	const checks=Math.ceil(hold/cadence),entryTx=1+profile[0],exitTx=profile[2];
	const fee=cents(capital*f.fee_buffer_bps/10000),gas=n=>cents(n*chain.gas_per_tx_usd);
	const opportunity=cents(capital*f.opportunity_apr*(hold+profile[3])/365);
	const setupCost=cents(gas(entryTx)+fee),exitCost=cents(gas(exitTx)+fee);
	const growth=Number.isFinite(p.change_7d) ? (p.change_7d >= 0 ? '+' : '')+p.change_7d.toFixed(2)+'% in 7d' : '7d growth unreported';
	const steps=[];
	function step(phase,title,action,tx,minutes,extra,days,opp) {
		const cost=cents(gas(tx)+extra);
		const time=days ? days+' days; '+minutes+' active min' : minutes+' min';
		const costText=money(cost)+' ('+tx+' tx × '+money(chain.gas_per_tx_usd)+' gas'+(extra ? '+'+money(extra)+' fee reserve' : '')+')'+(opp ? '; '+money(opp)+' opportunity cost at 5% APR' : '');
		steps.push({ number: steps.length+1,phase,title,action,transactions: tx,gas_usd: gas(tx),
			fee_buffer_usd: extra,est_cost_usd: cost,opportunity_cost_usd: opp || 0,
			active_minutes: minutes,duration_days: days || 0,
			text: action+' Cost: '+costText+'. Time: '+time+'.' });
	}
	step('setup','Verify route',`${p.name}: TVL ${compactUsd(p.tvl_usd)},${growth} at ${model.as_of}. Cheapest listed chain: ${chain.chain} (gas table). Verify app/asset/eligibility; no points assumed.`,0,f.qualify_minutes,0,0,0);
	step('setup','Fund the wallet',`On ${chain.chain}: $${f.test_capital_usd} test/$${capital} standard/$${capital*f.extended_capital_factor} extended. Transfer $${capital} plus ${money(setupCost+exitCost)} fee reserve. Capital at risk; quote bridge/onboarding separately.`,1,f.fund_minutes,0,0,0);
	step('setup','Open one position',farmAction(p,family,capital,chain.chain),profile[0],profile[1],fee,0,0);
	step('monitor','Hold and record',`Hold ${p.name} for ${weeks} weeks; check balance/exits/points every ${cadence} days (${checks} checks). Log receipt units. No weekly tx/reward assumed. ${money(capital)} exposed.`,0,checks*f.check_minutes,0,hold,opportunity);
	const risk={ lending: 'Watch oracle and liquidation risk.',dex: 'Watch divergence loss and range status.',yield: 'Inspect strategy leverage,curators and exit queues.',rwa: 'Check issuer solvency and redemption gates.',staking: 'Check slashing,receipt depegs and unbonding.',basis: 'Check backing,custodians and funding reversals.',derivatives: 'Watch margin/funding; full position can be lost.',other: 'Verify custody/redemption; product may offer no campaign.' }[family];
	step('monitor','Review the exit risk',`${risk} ${growth} is not yield. If fresh TVL drops >${-f.stress_growth_pct}% weekly or exits change,stop adding funds; log fees.`,0,f.risk_review_minutes,0,0,0);
	step('exit','Unwind and revoke',`On ${chain.chain},${family==='lending' ? 'repay debt,' : family==='derivatives' ? 'close trades,' : ''}redeem ${p.name}'s receipt/remove position; revoke approvals. Budget ${profile[3]} extra wait days; verify lockups. Log costs/losses.`,exitTx,f.exit_minutes,fee,profile[3],0);
	return {
		family,chain: chain.chain,gas_per_tx_usd: chain.gas_per_tx_usd,
		gas_known: chain.known,chain_choices: chain.choices,capital_usd: capital,
		capital_tiers: [f.test_capital_usd,capital,capital*f.extended_capital_factor],
		est_setup_cost_usd: setupCost,est_exit_cost_usd: exitCost,
		gas_total_usd: cents(gas(entryTx)+gas(exitTx)),fee_buffer_total_usd: cents(fee*2),
		opportunity_cost_usd: opportunity,est_total_cost_usd: cents(setupCost+exitCost+opportunity),
		capital_at_risk_usd: capital,setup_minutes: f.qualify_minutes+f.fund_minutes+profile[1],
		hold_weeks: weeks,hold_days: hold,exit_wait_days_assumed: profile[3],
		check_every_days: cadence,check_count: checks,monitoring_minutes: checks*f.check_minutes+f.risk_review_minutes,
		total_active_minutes: f.qualify_minutes+f.fund_minutes+profile[1]+checks*f.check_minutes+f.risk_review_minutes+f.exit_minutes,
		eligibility: 'unverified',
		assumptions: f.assumptions,steps
	};
}
function flagsFor(p,model) {
	return [model.time.imputed && 'Age imputed',model.growth.missing && 'Growth unreported',
		model.growth.clamped && 'Growth clamped',model.multiple.n < C.confidence_medium_n && 'Sparse peers',
		/bridge|liquid staking|liquid restaking|restaked btc|anchor btc|decentralized btc/i.test(categoryOf(p)) && 'Product record: existing asset possible; independent launch unverified',
		p.change_7d < FARM.stress_growth_pct && 'TVL drawdown'].filter(Boolean);
}
function buildRadar(data) {
	const protocols=data.protocols.slice().sort((a,b)=>cmp(a.slug,b.slug));
	const cal=deriveMultiples(protocols,data.as_of);
	const watch=new Set(data.watchlist);
	const rows=protocols.filter(isRankable).map(p=>{
		const model=impliedValue(p,cal),plan=buildFarmPlan(p,model);
		return { ...p,token_status: 'pre-token',watchlist: watch.has(p.slug),age_days: model.time.age_days,
			implied_value_usd: model.implied_value_usd,model,flags: flagsFor(p,model),
			farm_plan: plan,farm_steps: plan.steps.map(s=>s.text) };
	}).sort((a,b)=>b.implied_value_usd-a.implied_value_usd || cmp(a.slug,b.slug))
		.map((p,i)=>({ rank: i+1,...p }));
	const validation=validatePeers(protocols,data.as_of);
	const excluded=protocols.filter(p=>classify(p)==='token-recorded' || !isRankable(p) && classify(p)==='pre-token').map(p=>({
		...p,token_status: classify(p),exclusion_rules:exclusionRules(p),
		reason: classify(p)==='token-recorded' ? 'Token identifier recorded; positive market cap unreported.' : 'excluded: derivative/infrastructure of a traded token; '+exclusionRules(p).join('; ')
	}));
	return {
		as_of: data.as_of,floor_usd: data.floor_usd,version: VERSION,
		constants: C,method: METHOD,farm_assumptions: FARM,gas_table: GAS,
		calibration: cal,category_multiples: cal.categories,validation: validation.stats,
		rows,trading_peers: validation.peers,excluded,
		summary: { protocols: protocols.length,board: rows.length,watchlist_total: watch.size,
			watchlist_covered: rows.filter(p=>p.watchlist).length,
			off_watchlist: rows.filter(p=>!p.watchlist).length,
			below_floor: rows.filter(p=>p.tvl_usd < data.floor_usd).length,
			trading_peers: validation.peers.length,
			token_recorded: protocols.filter(p=>classify(p)==='token-recorded').length,
			excluded_categories: excluded.filter(p=>p.token_status==='pre-token' && EXCLUDED_CATEGORIES.includes(p.category)).length,
			excluded_pre_token:excluded.filter(p=>p.token_status==='pre-token').length,
			total_implied_value_usd: rows.reduce((n,p)=>n+p.implied_value_usd,0) }
	};
}
const api={ VERSION,CONSTANTS: C,METHOD,FARM,GAS,FAMILY,EXCLUDED_CATEGORIES,
	classify,isRankable,exclusionRules,categoryOf,ageDays,deriveMultiples,impliedValue,
	spearman,validatePeers,familyOf,cheapestChain,buildFarmPlan,buildRadar };
if (typeof module==='object' && module.exports) module.exports=api;
else root.RadarModel=api;
})(typeof globalThis!=='undefined' ? globalThis : this);
