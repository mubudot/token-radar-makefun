(function () {
  'use strict';

  const data = window.RADAR_DATA;
  const Model = window.RadarModel;
  if (!data || !Model) return;
  const radar = Model.buildRadar(data);
  const categoryOf = Model.categoryOf;
  const {
    rows,
    trading_peers: peers,
    excluded,
    category_multiples: categories,
    summary: counts,
    validation: stats,
    calibration: cal,
    constants,
    method,
    farm_assumptions: farm
  } = radar;
  const slugMap = new Map();
  for (const x of [...excluded, ...peers, ...rows]) slugMap.set(x.slug, x);
  const preTvl = rows.reduce((sum, r) => sum + r.tvl_usd, 0);
  const byId = id => document.getElementById(id);
  const queryAll = s => document.querySelectorAll(s);
  const resolveElement = t => typeof t === 'string' ? byId(t) : t;
  const listen = (t, e, fn) => resolveElement(t).addEventListener(e, fn);
  const setPressed = (t, v) => resolveElement(t).setAttribute('aria-pressed', v ? 'true' : 'false');
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  // Append snapshot strings as text nodes; raw data never becomes HTML.
  const element = (t, c, ...k) => {
    const n = document.createElement(t);
    if (c) n.className = c;
    for (const x of k) if (x !== null && x !== undefined && x !== false) n.append(typeof x === 'object' ? x : String(x));
    return n;
  };
  const div = (c, ...k) => element('div', c, ...k);
  const span = (c, ...k) => element('span', c, ...k);
  const paragraph = (c, ...k) => element('p', c, ...k);
  const button = (c, txt, fn) => {
    const b = element('button', c, txt);
    b.type = 'button';
    if (fn) listen(b, 'click', fn);
    return b;
  };
  const badge = (c, t, tip) => {
    const n = span('bdg' + (c ? ' ' + c : ''), t);
    if (tip) n.title = tip;
    return n;
  };
  const currencyFormat = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  });
  const usd = n => !Number.isFinite(n) ? 'n/a' : Math.abs(n) >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : currencyFormat.format(n);
  const wholeUsd = n => Number.isFinite(n) ? currencyFormat.format(Math.round(n)) : 'n/a';
  const decimalUsd = n => Number.isFinite(n) ? '$' + n.toFixed(n > 0 && n < 0.01 ? 3 : 2) : 'n/a';
  const percent = n => Number.isFinite(n) ? (n > 0 ? '+' : '') + n.toFixed(2) + '%' : 'n/a';
  const fixed = (n, d = 2, s = '') => Number.isFinite(n) ? n.toFixed(d) + s : '—';
  const factor = (n, d = 3) => fixed(n, d, '×');
  const growthCell = v => [percent(v), Number.isFinite(v) ? v >= 0 ? 'pos' : 'neg' : 'mut'];
  const keyValues = p => div('kvs', ...p.map(([k, v]) => div('kv', span('', k), element('b', '', v))));
  const sectionBox = (tit, ...k) => element('section', 'box', span('lbl', tit), ...k);
  const keyValueBox = (tit, p, foot) => sectionBox(tit, keyValues(p), foot && paragraph('mut', foot));
  const metricCards = p => div('g4', ...p.map(([k, v]) => div('dc', span('', k), element('b', '', v))));
  const ageCell = (r, tag) => {
    const t = r.model.time;
    if (!t.imputed) return t.age_days + 'd';
    const n = span('', '~' + Math.round(t.used_days) + 'd', tag && span('imp', tag));
    n.title = 'Imputed via ' + t.source;
    return n;
  };
  const flagBadges = r => (r.flags || []).map(text => {
    const label = text === 'Growth unreported' ? 'NO 7D' : text === 'Growth clamped' ? 'CLAMP' : text.split(' ')[0].toUpperCase();
    return badge('fl', label, text);
  });
  const hashDefaults = {
    tab: 'board',
    q: '',
    cat: 'all',
    chain: 'all',
    minTvl: 0,
    pos: 0,
    watch: 0,
    sort: 'implied',
    dir: -1,
    ex: 'pre'
  };
  const state = {
    ...hashDefaults,
    pSort: 'mcap',
    pDir: -1,
    mSort: 'n',
    mDir: -1,
    sel: null
  };
  const updateView = () => {
    syncHash(1);
    render();
  };
  const sortHandler = (kk, dk, ascRe, sync) => k => {
    state[dk] = state[kk] === k ? -state[dk] : ascRe.test(k) ? 1 : -1;
    state[kk] = k;
    sync ? updateView() : render();
  };
  // Persist filters and an optional detail slug for reproducible local views.
  function syncHash(w) {
    if (!w) {
      const sp = new URLSearchParams(location.hash.slice(1));
      for (const [k, d] of Object.entries(hashDefaults)) {
        const v = sp.get(k);
        state[k] = typeof d === 'number' ? v === null ? d : +v || 0 : v || d;
      }
      if (!/^(board|watchlist|peers|model)$/.test(state.tab)) state.tab = 'board';
      state.dir = state.dir === 1 ? 1 : -1;
      state.sel = sp.get('p') || null;
      return;
    }
    const p = new URLSearchParams();
    for (const [k, d] of Object.entries(hashDefaults)) if (!(k === 'watch' && state.tab !== 'board') && state[k] !== d) p.set(k, state[k]);
    if (state.sel) p.set('p', state.sel);
    history.replaceState(null, '', p.toString() ? '#' + p : location.pathname + location.search);
  }
  // Populate snapshot totals and validation from the computed model.
  function renderHeader() {
    byId('ver').textContent = radar.version;
    byId('meta').textContent = `Snapshot ${radar.as_of} UTC · DefiLlama (${counts.protocols} protocols, ${usd(radar.floor_usd)} floor) · "records no token" ≠ token absent`;
    for (const [tab, n] of Object.entries({ board: counts.board, watchlist: `${counts.watchlist_covered}/${counts.watchlist_total}`, peers: peers.length, model: categories.length })) {
      byId('c-' + tab).textContent = n;
    }
    byId('ftvl').replaceChildren(...[0, 1e7, 25e6, 5e7, 1e8, 25e7, 1e9].map(v => new Option(v ? v === 5e7 ? '≥$50M Floor' : '≥' + usd(v).replace('.00', '') : 'Any (≥$5M)', v)));
    byId('kpis').replaceChildren(...[['Pre-token board', counts.board, `${counts.off_watchlist} off-watch · ${counts.below_floor} <$50M`],
      ['Watchlist', `${counts.watchlist_covered}/${counts.watchlist_total}`, '100% ≥$50M non-deriv', 1],
      ['Pre-token TVL', usd(preTvl), `${counts.board} ranked protocols`],
      ['Sum implied value', usd(counts.total_implied_value_usd), 'Implied mcap proxy', 1],
      ['LOO within 3×', `${fixed(stats.within_3x_share * 100, 1)}% (${stats.within_3x_count}/${stats.n})`, `Med ${factor(stats.median_error_factor, 2)} · ρ ${fixed(stats.spearman, 3)}`],
      ['Separated', `${counts.trading_peers}/${counts.excluded_pre_token}/${counts.token_recorded}`, 'Trades · Deriv · Token-rec']].map(([l, val, sub, hi]) => div('kpi', span('lbl', l), element('strong', 'kval' + (hi ? ' hi' : ''), val), span('sm', sub))));
  }
  // Count filter options in the active universe, before applying filters.
  function populateSelects(pool) {
    const mc = new Map();
    const mh = new Map();
    const inc = (m, k) => m.set(k, (m.get(k) || 0) + 1);
    for (const r of pool) {
      inc(mc, categoryOf(r));
      for (const ch of r.chains || []) inc(mh, ch);
    }
    for (const [id, lbl, map, cur] of [['fcat', 'All categories', mc, state.cat], ['fchn', 'All chains', mh, state.chain]]) {
      const sel = byId(id);
      sel.replaceChildren(new Option(`${lbl} (${map.size})`, 'all'), ...[...map.keys()].sort(compare).map(k => new Option(`${k} (${map.get(k)})`, k)));
      sel.value = map.has(cur) || cur === 'all' ? cur : 'all';
    }
  }
  const filterRows = (pool, watch) => {
    const q = state.q.trim().toLowerCase();
    return pool.filter(r => (!watch || r.watchlist) && (state.cat === 'all' || categoryOf(r) === state.cat) && (state.chain === 'all' || (r.chains || []).includes(state.chain)) && (state.minTvl <= 0 || r.tvl_usd >= state.minTvl) && (!state.pos || Number.isFinite(r.change_7d) && r.change_7d > 0) && (!q || `${r.name} ${r.slug} ${categoryOf(r)} ${(r.chains || []).join(' ')}`.toLowerCase().includes(q)));
  };
  const sortBy = (list, key, dir, g) => list.slice().sort((a, b) => compare((g[key] || g._def)(a), (g[key] || g._def)(b)) * dir || compare(a.slug || a.category, b.slug || b.category));
  const sortFields = {
    name: r => r.name.toLowerCase(),
    category: categoryOf,
    tvl: r => r.tvl_usd,
    growth: r => Number.isFinite(r.change_7d) ? r.change_7d : -Infinity,
    age: r => r.model.time.used_days
  };
  // Share sortable headers and keyboard row activation across all tables.
  function makeTable(spec, list, curKey, curDir, onSort, rowSlug) {
    const cols = spec.split(',').map(p => p.split(':'));
    const htr = element('tr', '', ...cols.map(([lbl, key, cls]) => {
      const th = element('th', cls && /\bnum\b/.test(cls) ? 'num' : '');
      th.scope = 'col';
      if (!key || !onSort) {
        th.textContent = lbl;
        return th;
      }
      const b = button('', lbl, () => onSort(key));
      if (curKey === key) {
        th.setAttribute('aria-sort', curDir < 0 ? 'descending' : 'ascending');
        const icon = span('sind', curDir < 0 ? '▼' : '▲');
        icon.setAttribute('aria-hidden', 'true');
        b.append(icon);
      }
      b.dataset.on = curKey === key;
      th.append(b);
      return th;
    }));
    const tb = element('tbody');
    for (const r of list) {
      const tr = element('tr', r.cls || '', ...(r.cells || r).map((c, i) => {
        const a = Array.isArray(c);
        const td = element('td', [cols[i][2], a && c[1]].filter(Boolean).join(' '), a ? c[0] : c);
        if (a && c[2]) td.title = c[2];
        return td;
      }));
      const slug = rowSlug && rowSlug(r);
      if (slug) {
        tr.tabIndex = 0;
        tr.dataset.sel = state.sel === slug;
        listen(tr, 'click', () => openDetail(slug));
        listen(tr, 'keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(slug);
          }
        });
      }
      tb.append(tr);
    }
    return div('twrap', element('table', '', element('thead', '', htr), tb));
  }
  // Keep removable filter chips consistent with the visible row count.
  function renderStatus(total, shown) {
    const rs = byId('rstat');
    rs.textContent = '';
    rs.append(state.tab === 'model' ? `${categories.length} categories · ${excluded.length} excluded` : `Showing ${shown} of ${total} rows`);
    const chips = [
      ['Search', 'q', state.q.trim()], ['Category', 'cat', state.cat],
      ['Chain', 'chain', state.chain], ['TVL ≥', 'minTvl', state.minTvl],
      ['7d > 0', 'pos', state.pos],
      ['Watchlist', 'watch', state.watch]
    ].filter(([, k, v]) => v !== hashDefaults[k] && (k !== 'watch' || state.tab === 'board'));
    const row = byId('chips');
    row.hidden = !chips.length;
    row.replaceChildren(...chips.map(([l, k, v]) => button('tag acc', `${l}: ${v} ×`, () => {
      state[k] = hashDefaults[k];
      updateView();
    })));
  }
  // Filter and sort views without changing model ranks.
  function renderGridTab(panel, pool, watch, spec, g, sState, onSort, rowFn, head) {
    populateSelects(pool);
    const list = sortBy(filterRows(pool, watch), sState.k, sState.d, g);
    renderStatus(pool.length, list.length);
    if (!list.length) {
      panel.replaceChildren(div('panel', head, div('empty', element('h2', '', 'No matching rows'), button('btn', 'Reset filters', resetFilters))));
      return;
    }
    panel.replaceChildren(div('panel', head, makeTable(spec, list.map(rowFn), sState.k, sState.d, onSort, x => x.slug)));
  }
  // Board and watchlist share the same model rows and rank values.
  function renderBoard(panel, watchOnly) {
    const pool = watchOnly ? rows.filter(r => r.watchlist) : rows;
    const spec = 'Rank:rank:num rk,Protocol:name,Category:category:cat,Chains:chains:sm nw,TVL:tvl:num,7d %:growth:num,Age:age:num,Cat. Mult:multiple:num,Implied Value:implied:num,Farm Cost & Time:cost:num sm';
    const g = {
      ...sortFields,
      rank: r => r.rank,
      chains: r => r.chains[0] || '',
      multiple: r => r.model.multiple.factor,
      cost: r => r.farm_plan.est_total_cost_usd,
      _def: r => r.implied_value_usd
    };
    renderGridTab(panel, pool, watchOnly || state.watch, spec, g, {
      k: state.sort,
      d: state.dir
    }, sortHandler('sort', 'dir', /^(rank|name|category|chains|cost)$/, 1), r => {
      const chs = r.chains || [];
      const fp = r.farm_plan;
      const m = r.model.multiple;
      const cat = categoryOf(r);
      return {
        slug: r.slug,
        cells: [
          ['#' + r.rank, r.watchlist && 'w'],
          div('pcell', span('pname', r.name), span('row nw', r.watchlist && badge('w', 'WATCH'), badge('', 'PRE', 'Records no token'), ...flagBadges(r))),
          [cat, '', cat],
          [span('', chs.length ? chs.slice(0, 2).join(', ') : 'unreported', chs.length > 2 && span('more', '+' + (chs.length - 2))), '', chs.join(', ')],
          usd(r.tvl_usd), growthCell(r.change_7d), ageCell(r, 'imp'),
          [factor(m.factor), '', `Pivot ${factor(r.model.fit.pivot_multiple)} × size ${fixed(m.size_factor, 3)}`],
          span('ival', usd(r.implied_value_usd)),
          [span('', element('b', '', decimalUsd(fp.est_total_cost_usd)), ` · ${fp.hold_weeks}w/${fp.total_active_minutes}m · ${fp.chain}`), '', 'Gas + fees + opportunity + stress haircut; see detail']
        ]
      };
    }, div('phead', span('lbl', (watchOnly ? 'Watchlist' : 'Pre-token board') + ' · TVL × M × G × T'), span('mut', 'Open row for factors & plan')));
  }
  // Trading records show held-out predictions beside their actual caps.
  function renderPeers(panel) {
    const spec = 'Status,Protocol:name:pname,Category:category:cat,TVL:tvl:num,7d %:growth:num,Age:age:num,Actual Mcap:mcap:num,LOO Pred:pred:num,Pred/Mkt:ratio:num,|log10|:err:num,3×';
    const g = {
      ...sortFields,
      pred: p => p.predicted_value_usd,
      ratio: p => p.predicted_to_market,
      err: p => p.abs_log10_error,
      _def: p => p.mcap_usd
    };
    const head = div('phead', span('lbl', 'Trading peers · already trades · LOO'));
    renderGridTab(panel, peers, false, spec, g, {
      k: state.pSort,
      d: state.pDir
    }, sortHandler('pSort', 'pDir', /^(name|category|err)$/, 0), p => ({
      slug: p.slug,
      cells: [badge('tr', 'TRADES' + (p.symbol ? ' · ' + p.symbol : '')), p.name, categoryOf(p), usd(p.tvl_usd), growthCell(p.change_7d), ageCell(p, '*'), usd(p.mcap_usd), usd(p.predicted_value_usd), factor(p.predicted_to_market, 2), fixed(p.abs_log10_error, 3), badge(p.within_3x ? 'ok' : 'no', p.within_3x ? 'PASS' : 'OUT')]
    }), head);
  }
  // Show the actual fold metrics and named priors beside the fitted category table.
  function renderModel(panel) {
    renderStatus(0, 0);
    const formula = sectionBox('Formula & method',
      div('fbox', method.formula),
      ...['fit', 'growth', 'time', 'missing_age', 'limits'].map(k => paragraph('', method[k]))
    );
    const metrics = [['Ensemble v4', stats], ['Baseline', stats.baseline]].map(([label, s]) => [
      label, s.n, fixed(s.spearman, 6), factor(s.median_error_factor, 4),
      `${s.within_3x_count}/${s.n} (${fixed(s.within_3x_share * 100, 3)}%)`
    ]);
    const diagnostics = sectionBox('Leave-one-out validation',
      makeTable('Model,N::num,Spearman::num,Error ×::num,Within 3×::num', metrics),
      keyValues([
        ['Fitted β / τ', `${fixed(cal.fit.base_beta, 4)} / ${fixed(cal.fit.base_time_power, 4)}`],
        ['Imputed age / missing 7d', `${stats.missing_age_n} / ${stats.missing_growth_n}`]
      ]),
      paragraph(stats.rank_beats_baseline ? 'pos' : 'neg',
        stats.rank_beats_baseline ? 'Spearman beats baseline.' : 'Baseline ranks better.'),
      paragraph('mut', stats.selection_note),
      paragraph('mut', stats.note)
    );
    const assumptions = keyValueBox('Constants', [
      ...Object.entries(constants),
      ...['opportunity_apr', 'fee_buffer_bps', 'smart_contract_haircut_rate', 'depeg_haircut_rate']
        .map(k => [k, farm[k]])
    ]);
    const sorted = sortBy(categories, state.mSort, state.mDir, {
      cat: x => x.category, piv: x => x.fit.pivot_multiple, _def: x => x.n
    });
    const categoryTable = makeTable(
      'Category:cat:cat,Peers:n:num,Weight::num,Pivot M:piv:num,Peers::pslug',
      sorted.map(c => [c.category, c.n, fixed(c.fit.shrink_weight), factor(c.fit.pivot_multiple),
        tooltip(c.peer_slugs.join(', ') || 'pooled prior')]),
      state.mSort, state.mDir, sortHandler('mSort', 'mDir', /^cat$/, false)
    );
    const controls = div('row', ...[['pre', 'Pre-token'], ['rec', 'Token recorded'], ['all', 'All']].map(([k, label]) => {
      const b = button('btn', label, () => {
        state.ex = k;
        updateView();
      });
      setPressed(b, state.ex === k);
      return b;
    }));
    const excludedRows = excluded.filter(x => state.ex === 'all' ||
      x.token_status === (state.ex === 'pre' ? 'pre-token' : 'token-recorded'));
    const exclusions = makeTable('Protocol::pname,Category::cat,Rule / Reason::mut',
      excludedRows.map(x => ({ slug: x.slug, cells: [x.name, categoryOf(x), tooltip(x.reason)] })),
      null, 1, null, x => x.slug
    );
    panel.replaceChildren(div('g3', formula, diagnostics, assumptions), div('g2 g2m mt',
      tablePanel('Category pivot multiples · $100M TVL', categoryTable),
      tablePanel(`Excluded (${excludedRows.length}/${excluded.length})`, exclusions, controls)
    ));
  }

  // Long evidence strings stay accessible as tooltips without widening the tables.
  function tooltip(text) {
    return [span('why', text), '', text];
  }

  function tablePanel(title, table, controls) {
    table.classList.add('stbl');
    return div('panel', div('phead', span('lbl', title), controls), table);
  }

  // Keep both applied factors and their raw inputs near the top of the drawer.
  function openDetail(slug) {
    const item = slugMap.get(slug);
    if (!item) return;
    state.sel = slug;
    syncHash(true);
    const mo = item.model || Model.impliedValue(item, cal);
    const { multiple: m, growth: g, time: t, fit: f } = mo;
    const isPeer = item.token_status === 'trades';
    const title = element('h2', 'd-title', item.name);
    title.id = 'd-title';
    const close = button('btn', 'Close ×', () => drawer.close());
    close.autofocus = true;
    const header = div('d-hd', div('',
      div('row', badge('', item.rank ? `#${item.rank}/${counts.board}` : isPeer ? 'TRADES · LOO' : 'EXCLUDED'),
        item.watchlist && badge('w', 'WATCH'), badge('', mo.confidence), ...flagBadges(item)),
      title, paragraph('mut', `${categoryOf(item)} · ${item.slug} · listed ${item.listed_at || 'n/a'}`),
      item.reason && paragraph('mut', item.reason)), close
    );
    const formula = sectionBox(isPeer ? 'LOO vs market cap' : 'Worked formula',
      div('fbox', `${usd(mo.tvl_usd)} TVL × ${factor(m.factor, 5)} M × ${factor(g.factor, 4)} G × ${factor(t.factor, 4)} T = ${wholeUsd(mo.implied_value_usd)}`),
      isPeer && paragraph('mut', 'Actual market cap: ' + wholeUsd(item.mcap_usd))
    );
    const factors = div('g3',
      keyValueBox('Multiple M_eff', [
        ['Peers / shrink weight', `${m.n} / ${fixed(f.shrink_weight)}`],
        ['a_category / pooled', `${fixed(f.log_intercept, 3)} / ${fixed(f.pooled_log_intercept, 3)}`],
        ['Pivot × size', `${factor(f.pivot_multiple)} × ${fixed(m.size_factor, 3)} (β=${fixed(f.beta, 3)})`]
      ]),
      keyValueBox('Growth G · fixed prior', [
        ['7d growth %', percent(g.raw_pct)],
        ['Used % / weight', `${percent(g.used_pct)} / ${g.weight}`],
        ['Applied G', factor(g.factor, 4)]
      ], g.missing ? 'Unreported → G=1 (flagged).' : 'Clip −50%…+100%; G 0.8706…1.1487×.'),
      keyValueBox('Time without token T*', [
        [isPeer ? 'Tracking age (days)' : 'Days without token*', `${t.imputed ? '~' : ''}${t.used_days} (${t.source})`],
        ['Base ^ exponent', `${fixed(t.base_factor, 4)} ^ ${fixed(t.fit_power, 4)}`],
        ['Applied T', factor(t.factor, 4)]
      ], '*Tracking-age proxy; token history unavailable. ~ means imputed.')
    );
    const evidence = sectionBox(`Category peers (${m.n}${m.omitted_slug ? ', target omitted' : ''})`,
      paragraph('mut', m.peer_slugs.join(', ') || 'Pooled prior: no category peers.')
    );
    byId('d-body').replaceChildren(header, formula, factors, evidence,
      farmPlanView(item.farm_plan || Model.buildFarmPlan(item, mo)));
    if (!drawer.open) drawer.showModal();
  }

  // Render the model's complete costed steps rather than recreating their ledger.
  function farmPlanView(plan) {
    const totals = [
      ['Capital at risk', decimalUsd(plan.capital_at_risk_usd)],
      ['Cash: gas + fees', decimalUsd(plan.cash_cost_usd)],
      [`Opportunity @${farm.opportunity_apr * 100}%/yr`, decimalUsd(plan.opportunity_cost_usd)],
      ['All-in budget', decimalUsd(plan.est_total_cost_usd)],
      ['Gas (all steps)', decimalUsd(plan.gas_total_usd)],
      ['Fee/slippage reserve', decimalUsd(plan.fee_buffer_total_usd)],
      [`Contract haircut ${farm.smart_contract_haircut_rate * 100}%`, decimalUsd(plan.smart_contract_haircut_usd)],
      [`Depeg haircut ${farm.depeg_haircut_rate * 100}%`, decimalUsd(plan.depeg_haircut_usd)]
    ];
    const steps = plan.steps.map(s => element('li', 'step', span('snum', s.number),
      div('', span('stit', `${s.phase}: ${s.title}`), paragraph('sact', s.text))));
    return sectionBox(`Farm plan · ${plan.family} on ${plan.chain} (${plan.eligibility})`,
      metricCards(totals),
      paragraph('mut', `$${plan.capital_tiers.join('/$')} tiers; ${plan.hold_weeks}w hold + ${plan.exit_wait_days_assumed}d exit; ${plan.total_active_minutes} active min. Opportunity/haircut horizon: ${plan.risk_horizon_days}d.`),
      element('ol', 'steps', ...steps),
      paragraph('mut', `${plan.assumptions} Gas ${decimalUsd(plan.gas_per_tx_usd)}/tx (${plan.gas_known ? 'table' : 'fallback'}).`)
    );
  }

  // Restore filter defaults while preserving the active tab and sort.
  function resetFilters() {
    state.q = '';
    state.cat = 'all';
    state.chain = 'all';
    state.minTvl = 0;
    state.pos = 0;
    state.watch = 0;
    updateView();
  }
  // Switch panels and synchronize controls with hash-derived state.
  function render() {
    const views = {
      board: () => renderBoard(byId('p-board'), 0),
      watchlist: () => renderBoard(byId('p-watchlist'), 1),
      peers: () => renderPeers(byId('p-peers')),
      model: () => renderModel(byId('p-model'))
    };
    for (const t in views) {
      const onT = state.tab === t;
      byId('t-' + t).setAttribute('aria-selected', onT ? 'true' : 'false');
      byId('p-' + t).hidden = !onT;
    }
    byId('flt').hidden = state.tab === 'model';
    byId('fq').value = state.q;
    byId('fcat').value = state.cat;
    byId('fchn').value = state.chain;
    byId('ftvl').value = state.minTvl;
    setPressed('fpos', state.pos);
    byId('fwat').disabled = state.tab !== 'board';
    setPressed('fwat', state.tab === 'watchlist' || state.tab === 'board' && state.watch);
    views[state.tab]();
  }
  queryAll('[role="tab"]').forEach(b => listen(b, 'click', () => {
    state.tab = b.dataset.t;
    updateView();
  }));
  [['fq', 'input', 'q'], ['fcat', 'change', 'cat'], ['fchn', 'change', 'chain'], ['ftvl', 'change', 'minTvl']].forEach(([id, ev, k]) => listen(id, ev, e => {
    state[k] = k === 'minTvl' ? +e.target.value || 0 : e.target.value;
    updateView();
  }));
  listen('fpos', 'click', () => {
    state.pos = state.pos ? 0 : 1;
    updateView();
  });
  listen('fwat', 'click', () => {
    if (state.tab === 'board') {
      state.watch = state.watch ? 0 : 1;
      updateView();
    }
  });
  listen('frst', 'click', resetFilters);
  const drawer = byId('drawer');
  listen(drawer, 'close', () => {
    state.sel = null;
    syncHash(1);
    queryAll('tbody tr[data-sel="true"]').forEach(tr => {
      tr.dataset.sel = 'false';
    });
  });
  if (!('closedBy' in HTMLDialogElement.prototype)) listen(drawer, 'click', e => {
    const r = drawer.getBoundingClientRect();
    if (e.clientX < r.left || e.clientY < r.top || e.clientY > r.bottom) drawer.close();
  });
  listen(window, 'keydown', e => {
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !drawer.open && !/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement || {}).tagName)) {
      e.preventDefault();
      byId('fq').focus();
    }
  });
  listen(window, 'hashchange', () => {
    syncHash(0);
    render();
    if (state.sel) openDetail(state.sel);
    else if (drawer.open) drawer.close();
  });
  syncHash(0);
  renderHeader();
  render();
  if (state.sel) openDetail(state.sel);
})();
