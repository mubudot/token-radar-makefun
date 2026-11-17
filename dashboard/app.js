(function(){
'use strict';
const D=window.RADAR_DATA,
RM=window.RadarModel;
if(!D||!RM)return;
const R=RM.buildRadar(D),
M=Math,
fin=Number.isFinite,
OE=Object.entries,
catOf=RM.categoryOf;
const{
rows,
trading_peers:peers,
excluded:ex,
category_multiples:cats,
summary:S,
validation:V,
calibration:cal,
constants:C,
method:md,
farm_assumptions:fa
}=R;
const peerMap=new Map(peers.map((p)=>[p.slug,p])),
slugMap=new Map(),
catRank=new Map(),
catCount=new Map();
for(const x of[...ex,...peers,...rows])slugMap.set(x.slug,x);
let preTvl=0;
for(const r of rows){
preTvl+=r.tvl_usd;
const c=catOf(r),
n=(catCount.get(c)||0)+1;
catCount.set(c,n);
catRank.set(r.slug,{
rank:n,
cat:c
});
}
const $=(id)=>document.getElementById(id),
qsa=(s)=>document.querySelectorAll(s),
elOf=(t)=>typeof t==='string'?$(t):t;
const on=(t,e,fn)=>elOf(t).addEventListener(e,fn),
press=(t,v)=>elOf(t).setAttribute('aria-pressed',v?'true':'false');
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const el=(t,c,...k)=>{
const n=document.createElement(t);
if(c)n.className=c;
for(const x of k)if(x!==null&&x!==undefined&&x!==false)n.append(typeof x==='object'?x:String(x));
return n;
};
const dv=(c,...k)=>el('div',c,...k),
sp=(c,...k)=>el('span',c,...k),
pg=(c,...k)=>el('p',c,...k);
const btn=(c,txt,fn)=>{
const b=el('button',c,txt);
b.type='button';
if(fn)on(b,'click',fn);
return b;
};
const bdg=(c,t,tip)=>{
const n=sp('bdg'+(c?' '+c:''),t);
if(tip)n.title=tip;
return n;
};
const iFmt=new Intl.NumberFormat('en-US',{
style:'currency',
currency:'USD',
maximumFractionDigits:0
});
const u=(n)=>!fin(n)?'n/a':M.abs(n)>=1e9?'$'+(n/1e9).toFixed(2)+'B':M.abs(n)>=1e6?'$'+(n/1e6).toFixed(2)+'M':M.abs(n)>=1e3?'$'+(n/1e3).toFixed(1)+'K':iFmt.format(n);
const uInt=(n)=>fin(n)?iFmt.format(M.round(n)):'n/a';
const usd2=(n)=>fin(n)?'$'+n.toFixed(n>0&&n<0.01?3:2):'n/a';
const pct=(n)=>fin(n)?(n>0?'+':'')+n.toFixed(2)+'%':'n/a';
const fx=(n,d=2,s='')=>fin(n)?n.toFixed(d)+s:'—';
const mx=(n,d=3)=>fx(n,d,'×');
const chg=(v)=>[pct(v),fin(v)?v>=0?'pos':'neg':'mut'];
const kv=(p)=>dv('kvs',...p.map(([k,v])=>dv('kv',sp('',k),el('b','',v))));
const box=(tit,...k)=>el('section','box',sp('lbl',tit),...k);
const kvBox=(tit,p,foot)=>box(tit,kv(p),foot&&pg('mut',foot));
const dcRow=(p)=>dv('g4',...p.map(([k,v])=>dv('dc',sp('',k),el('b','',typeof v==='number'?uInt(v):v))));
const ageNode=(r,tag)=>{
const t=r.model.time;
if(!t.imputed)return r.age_days+'d';
const n=sp('','~'+M.round(t.used_days)+'d',tag&&sp('imp',tag));
n.title='Imputed via '+t.source;
return n;
};
const FL=[['Sparse','SPARSE',`<${C.confidence_medium_n} category peers (prior-weighted M)`],['Age','AGE~','age imputed'],['Growth unr','NO 7D','7d missing (G=1)'],['Growth cl','CLAMP','7d clamped'],['Product','PRODUCT','existing asset possible'],['TVL','DRAWDN',`7d TVL < ${fa.stress_growth_pct}%`]];
const flOf=(f)=>FL.find((x)=>f.startsWith(x[0]))||[f,f,f];
const flBdgs=(r)=>(r.flags||[]).map((f)=>{
const[,c,t]=flOf(f);
return bdg('fl',c,`Data-quality flag: ${f} (${t})`);
});
const HDEFS={
tab:'board',
q:'',
cat:'all',
chain:'all',
minTvl:0,
pos:0,
watch:0,
sort:'implied',
dir:-1,
ex:'pre'
};
const st={
...HDEFS,
pSort:'mcap',
pDir:-1,
mSort:'n',
mDir:-1,
sel:null
};
const go=()=>{
syncHash(1);
render();
};
const sorter=(kk,dk,ascRe,sync)=>(k)=>{
st[dk]=st[kk]===k?-st[dk]:ascRe.test(k)?1:-1;
st[kk]=k;
sync?go():render();
};
function syncHash(w){
if(!w){
const sp=new URLSearchParams(location.hash.slice(1));
for(const[k,d]of OE(HDEFS)){
const v=sp.get(k);
st[k]=typeof d==='number'?v===null?d:+v||0:v||d;
}
if(!/^(board|watchlist|peers|model)$/.test(st.tab))st.tab='board';
st.dir=st.dir===1?1:-1;
st.sel=sp.get('p')||null;
return;
}
const p=new URLSearchParams();
for(const[k,d]of OE(HDEFS))if(!(k==='watch'&&st.tab!=='board')&&st[k]!==d)p.set(k,st[k]);
if(st.sel)p.set('p',st.sel);
history.replaceState(null,'',p.toString()?'#'+p:location.pathname+location.search);
}
function renderHeader(){
$('ver').textContent=R.version;
$('meta').textContent=`Snapshot ${R.as_of} UTC · DefiLlama (${S.protocols} protocols, ${u(R.floor_usd)} floor) · "records no token" ≠ token absent`;
$('c-board').textContent=S.board;
$('c-watchlist').textContent=`${S.watchlist_covered}/${S.watchlist_total}`;
$('c-peers').textContent=S.trading_peers;
$('c-model').textContent=cats.length;
$('ftvl').replaceChildren(...[0,1e7,25e6,5e7,1e8,25e7,1e9].map((v)=>new Option(v?v===5e7?'≥$50M Floor':'≥'+u(v).replace('.00',''):'Any (≥$5M)',v)));
$('kpis').replaceChildren(...[['Pre-token board',S.board,`${S.off_watchlist} off-watch · ${S.below_floor} <$50M`],['Watchlist',`${S.watchlist_covered}/${S.watchlist_total}`,'100% ≥$50M non-deriv',1],['Pre-token TVL',u(preTvl),`${S.board} ranked protocols`],['Sum implied value',u(S.total_implied_value_usd),'Implied mcap proxy',1],['LOO within 3×',`${fx(V.within_3x_share*100,1)}% (${V.within_3x_count}/${V.n})`,`Med ${mx(V.median_error_factor,2)} · ρ ${fx(V.spearman,3)}`],['Separated',`${S.trading_peers}/${S.excluded_pre_token}/${S.token_recorded}`,'Trades · Deriv · Token-rec']].map(([l,val,sub,hi])=>dv('kpi',sp('lbl',l),el('strong','kval'+(hi?' hi':''),val),sp('sm',sub))));
}
function populateSelects(pool){
const mc=new Map(),
mh=new Map(),
inc=(m,k)=>m.set(k,(m.get(k)||0)+1);
for(const r of pool){
inc(mc,catOf(r));
for(const ch of r.chains||[])inc(mh,ch);
}
for(const[id,lbl,map,cur]of[['fcat','All categories',mc,st.cat],['fchn','All chains',mh,st.chain]]){
const sel=$(id);
sel.replaceChildren(new Option(`${lbl} (${map.size})`,'all'),...[...map.keys()].sort(cmp).map((k)=>new Option(`${k} (${map.get(k)})`,k)));
sel.value=map.has(cur)||cur==='all'?cur:'all';
}
}
const filterRows=(pool,watch)=>{
const q=st.q.trim().toLowerCase();
return pool.filter((r)=>(!watch||r.watchlist)&&(st.cat==='all'||catOf(r)===st.cat)&&(st.chain==='all'||(r.chains||[]).includes(st.chain))&&(st.minTvl<=0||r.tvl_usd>=st.minTvl)&&(!st.pos||fin(r.change_7d)&&r.change_7d>0)&&(!q||`${r.name} ${r.slug} ${catOf(r)} ${(r.chains||[]).join(' ')}`.toLowerCase().includes(q)));
};
const sortBy=(list,key,dir,g)=>list.slice().sort((a,b)=>cmp((g[key]||g._def)(a),(g[key]||g._def)(b))*dir||cmp(a.slug||a.category,b.slug||b.category));
const baseG={
name:(r)=>r.name.toLowerCase(),
category:(r)=>catOf(r),
tvl:(r)=>r.tvl_usd,
growth:(r)=>fin(r.change_7d)?r.change_7d:-Infinity,
age:(r)=>r.model.time.used_days
};
function mkTable(spec,list,curKey,curDir,onSort,rowSlug){
const cols=spec.split(',').map((p)=>p.split(':'));
const htr=el('tr','',...cols.map(([lbl,key,cls])=>{
const th=el('th',cls&&/\bnum\b/.test(cls)?'num':'');
th.scope='col';
if(!key||!onSort){
th.textContent=lbl;
return th;
}
const b=btn('',lbl,()=>onSort(key));
if(curKey===key){
th.setAttribute('aria-sort',curDir<0?'descending':'ascending');
const icon=sp('sind',curDir<0?'▼':'▲');
icon.setAttribute('aria-hidden','true');
b.append(icon);
}
b.dataset.on=curKey===key;
th.append(b);
return th;
}));
const tb=el('tbody');
for(const r of list){
const tr=el('tr',r.cls||'',...(r.cells||r).map((c,i)=>{
const a=Array.isArray(c),
td=el('td',[cols[i][2],a&&c[1]].filter(Boolean).join(' '),a?c[0]:c);
if(a&&c[2])td.title=c[2];
return td;
}));
const slug=rowSlug&&rowSlug(r);
if(slug){
tr.tabIndex=0;
tr.dataset.sel=st.sel===slug;
on(tr,'click',()=>openDetail(slug));
on(tr,'keydown',(e)=>{
if(e.key==='Enter'||e.key===' '){
e.preventDefault();
openDetail(slug);
}
});
}
tb.append(tr);
}
return dv('twrap',el('table','',el('thead','',htr),tb));
}
function renderStatus(total,shown){
const rs=$('rstat');
rs.textContent='';
if(st.tab==='model')rs.append(el('b','',cats.length),` categories · ${ex.length} excluded`);else rs.append('Showing ',el('b','',shown),` of ${total} rows`);
const chips=[st.q.trim()&&['Search: '+st.q.trim(),'q',''],st.cat!=='all'&&['Cat: '+st.cat,'cat','all'],st.chain!=='all'&&['Chain: '+st.chain,'chain','all'],st.minTvl>0&&['TVL ≥ '+u(st.minTvl),'minTvl',0],st.pos&&['7d > 0','pos',0],st.watch&&st.tab==='board'&&['Watchlist','watch',0]].filter(Boolean);
const row=$('chips');
row.hidden=!chips.length;
row.replaceChildren(...chips.map(([l,k,val])=>btn('tag acc',l+' ×',()=>{
st[k]=val;
go();
})));
}
function renderGridTab(panel,pool,watch,spec,g,sState,onSort,rowFn,head){
populateSelects(pool);
const list=sortBy(filterRows(pool,watch),sState.k,sState.d,g);
renderStatus(pool.length,list.length);
if(!list.length){
panel.replaceChildren(dv('panel',head,dv('empty',el('h2','','No matching rows'),pg('mut','Clear filters to restore.'),btn('btn','Reset filters',resetFilters))));
return;
}
const maxV=M.max(...list.map((r)=>r.implied_value_usd||0),1);
panel.replaceChildren(dv('panel',head,mkTable(spec,list.map((r)=>rowFn(r,maxV)),sState.k,sState.d,onSort,(x)=>x.slug)));
}
function renderBoard(panel,watchOnly){
const pool=watchOnly?rows.filter((r)=>r.watchlist):rows;
const spec='Rank:rank:num rk,Protocol:name,Category:category:cat,Chains:chains:sm nw,TVL:tvl:num,7d %:growth:num,Age:age:num,Cat. Mult:multiple:num,Implied Value:implied:num,Val/TVL:ratio:num mut,Farm Cost & Time:cost:num sm';
const g={
...baseG,
rank:(r)=>r.rank,
chains:(r)=>r.chains[0]||'',
multiple:(r)=>r.model.multiple.factor,
ratio:(r)=>r.implied_value_usd/r.tvl_usd,
cost:(r)=>r.farm_plan.est_total_cost_usd,
_def:(r)=>r.implied_value_usd
};
renderGridTab(panel,pool,watchOnly||st.watch,spec,g,{
k:st.sort,
d:st.dir
},sorter('sort','dir',/^(rank|name|category|chains|cost)$/,1),(r,maxV)=>{
const chs=r.chains||[],
fill=el('i'),
fp=r.farm_plan,
m=r.model.multiple,
cat=catOf(r);
fill.style.width=M.max(3,M.round(r.implied_value_usd/maxV*100))+'%';
return{
slug:r.slug,
cells:[['#'+r.rank,r.watchlist&&'w'],dv('pcell',sp('pname',r.name),sp('row nw',r.watchlist&&bdg('w','WATCH'),bdg('','PRE','Records no token'),...flBdgs(r))),[cat,'',cat],[sp('',chs.length?chs.slice(0,2).join(', '):'unreported',chs.length>2&&sp('more','+'+(chs.length-2))),'',chs.join(', ')],u(r.tvl_usd),chg(r.change_7d),ageNode(r,'imp'),[mx(m.factor),'',`Pivot ${mx(r.model.fit.pivot_multiple)} × size ${fx(m.size_factor,3)}`],dv('row nw',dv('bar',fill),sp('ival',u(r.implied_value_usd))),fx(r.implied_value_usd/r.tvl_usd*100,1,'%'),[sp('',el('b','',usd2(fp.est_total_cost_usd)),` · ${fp.hold_weeks}w/${fp.total_active_minutes}m · ${fp.chain}`),'',`Gas ${usd2(fp.gas_total_usd)} + fees ${usd2(fp.fee_buffer_total_usd)} + opportunity ${usd2(fp.opportunity_cost_usd)} + haircut ${usd2(fp.risk_haircut_usd)}; capital at risk ${usd2(fp.capital_at_risk_usd)}`]]
};
},dv('',dv('phead',sp('lbl',(watchOnly?'Watchlist':'Pre-token board')+' · ranked by implied value = TVL × M × G × T'),sp('mut','Click a row for formula & farm plan')),dv('flegend',sp('lbl','Flags (data quality)'),...FL.map(([,c,t])=>sp('',bdg('fl',c),' '+t)))));
}
function renderPeers(panel){
const spec='Status,Protocol:name:pname,Category:category:cat,TVL:tvl:num,7d %:growth:num,Age:age:num,Actual Mcap:mcap:num,LOO Pred:pred:num,Pred/Mkt:ratio:num,|log10|:err:num,3×';
const g={
...baseG,
pred:(p)=>p.predicted_value_usd,
ratio:(p)=>p.predicted_to_market,
err:(p)=>p.abs_log10_error,
_def:(p)=>p.mcap_usd
};
const head=dv('phead',sp('lbl','Trading peers · already trades (calibration & LOO)'),sp('mut','Never mixed into ranked board'));
renderGridTab(panel,peers,false,spec,g,{
k:st.pSort,
d:st.pDir
},sorter('pSort','pDir',/^(name|category|err)$/,0),(p)=>({
slug:p.slug,
cells:[bdg('tr','TRADES'+(p.symbol?' · '+p.symbol:'')),p.name,catOf(p),u(p.tvl_usd),chg(p.change_7d),ageNode(p,'*'),u(p.mcap_usd),u(p.predicted_value_usd),mx(p.predicted_to_market,2),fx(p.abs_log10_error,3),bdg(p.within_3x?'ok':'no',p.within_3x?'PASS':'OUT')]
}),head);
}
function renderModel(panel){
renderStatus(0,0);
const sBox=(tit,right,spec,rlist,args)=>{
const tw=mkTable(spec,rlist,...(args||[null,1,null,(x)=>x.slug]));
tw.classList.add('stbl');
return el('section','panel',dv('phead',sp('lbl',tit),right),tw);
};
const c1=box('Formula & method',dv('fbox',md.formula),dv('mlist',...['multiple','fit','growth','time','eligibility'].map((k)=>pg('',el('b','',k+': '),md[k]))),pg('mut',md.limits));
const c2=box(`LOO validation (n=${V.n})`,mkTable('Model,N::num,Med|log10|::num,Factor::num,Within 3×::num,ρ::num',[['Current (=before)',V,1],['v1 Ratio',V.legacy],['Baseline',V.baseline]].map(([l,s,hi])=>({
cls:hi?'hi':'',
cells:[l,s.n,fx(s.median_abs_log10_error,4),mx(s.median_error_factor,2),`${s.within_3x_count}/${s.n} (${fx(s.within_3x_share*100,1)}%)`,fx(s.spearman,4)]
}))),kv([['β / a_pooled',`${fx(cal.fit.beta,4)} / ${fx(cal.fit.pooled_log_intercept,4)}`],['Global raw',`${mx(cal.global.raw_multiple,4)} (${cal.global.n})`],['Imputed age / no 7d',`${V.missing_age_n} / ${V.missing_growth_n}`]]),pg('neg',V.rank_beats_baseline?'Model Spearman beats baseline.':`Baseline ranks better: ρ ${fx(V.baseline.spearman,4)} vs ${fx(V.spearman,4)}. No tested model improved rank without worsening error or coverage.`),pg('mut',V.selection_note),pg('mut',V.note));
const c3=kvBox('Constants',[...OE(C).map(([k,val])=>[k,k.endsWith('_usd')?u(val):String(val)]),['farm_tiers',`$${fa.test_capital_usd}/$${fa.small_capital_usd}/$${fa.medium_capital_usd}/$${fa.large_capital_usd}`],['fee_buffer_bps',fa.fee_buffer_bps],['opportunity_apr',`${fa.opportunity_apr*100}%/year`],['smart_contract_haircut_rate',`${fa.smart_contract_haircut_rate*100}% capital`],['depeg_haircut_rate',`${fa.depeg_haircut_rate*100}% capital`],['haircut horizon','hold + assumed exit wait']]);
const catSorted=sortBy(cats,st.mSort,st.mDir,{
cat:(x)=>x.category,
piv:(x)=>x.fit.pivot_multiple,
raw:(x)=>x.raw_multiple||0,
v1:(x)=>x.multiple,
age:(x)=>x.median_age_days||0,
_def:(x)=>x.n
});
const catSec=sBox(`Category multiples (${cats.length})`,sp('mut','Pivot @ $100M TVL = exp(a_cat)/$100M'),'Category:cat:cat,Peers:n:num,w::num mut,Mult@$100M:piv:num,a_cat::num mut,v1 Raw:raw:num mut,v1 Shrunk:v1:num mut,Age n/Med:age:num mut,Source::mut nw,Peers::pslug',catSorted.map((cm)=>[cm.category,cm.n,fx(cm.shrink_weight),mx(cm.fit.pivot_multiple),fx(cm.fit.log_intercept,3),mx(cm.raw_multiple),mx(cm.multiple),`${cm.age_sample_n}/${cm.median_age_days!==null?cm.median_age_days+'d':'—'}`,cm.source,((t)=>[sp('why',t),'',t])(cm.peer_slugs.length?cm.peer_slugs.join(', '):'global prior')]),[st.mSort,st.mDir,sorter('mSort','mDir',/^cat$/,0),null]);
const exBtns=dv('row nw',...[['pre',`Deriv (${S.excluded_pre_token})`],['rec',`Rec (${S.token_recorded})`],['all',`All (${ex.length})`]].map(([k,l])=>{
const b=btn('btn',l,()=>{
st.ex=k;
go();
});
press(b,st.ex===k);
return b;
}));
const exWhy=(x)=>{
const t=x.exclusion_rules?.length?x.exclusion_rules.join('; '):x.reason;
return[sp('why',t),'',t];
};
const exList=ex.filter((x)=>st.ex==='all'||(st.ex==='pre'?x.token_status==='pre-token':x.token_status==='token-recorded')).sort((a,b)=>b.tvl_usd-a.tvl_usd||cmp(a.slug,b.slug));
const peerSec=sBox(`Trading peers · LOO vs market (${peers.length})`,sp('mut','Click row for detail'),'Protocol::pname,Cat::cat,Mcap::num,LOO::num,Pred/Mkt::num,3×',peers.map((p)=>({
slug:p.slug,
cells:[p.name,catOf(p),u(p.mcap_usd),u(p.predicted_value_usd),mx(p.predicted_to_market,2),bdg(p.within_3x?'ok':'no',p.within_3x?'OK':'OUT')]
})));
peerSec.classList.add('mt');
panel.replaceChildren(dv('g3',c1,c2,c3),dv('g2 g2m mt',catSec,sBox(`Excluded (${ex.length})`,exBtns,'Protocol::pname,Category::cat,TVL::num,Rule / Reason::mut',exList.map((x)=>({
slug:x.slug,
cells:[x.name,catOf(x),u(x.tvl_usd),exWhy(x)]
})))),peerSec);
}
function openDetail(slug){
const item=slugMap.get(slug);
if(!item)return;
st.sel=slug;
syncHash(1);
const drawer=$('drawer'),
isR=item.token_status==='pre-token'&&fin(item.rank),
isP=item.token_status==='trades';
const mo=item.model||RM.impliedValue(item,cal),
fp=item.farm_plan||RM.buildFarmPlan(item,mo);
const{
multiple:m,
growth:g,
time:t,
fit:f
}=mo,
cat=catOf(item),
ci=catRank.get(item.slug);
const sBdgs=isR?[bdg('w',`#${item.rank}/${S.board}`),ci&&bdg('',`#${ci.rank}/${catCount.get(ci.cat)} ${ci.cat}`),item.watchlist&&bdg('w','WATCH'),bdg('','PRE-TOKEN')]:isP?[bdg('tr','TRADES · LOO'),bdg(item.within_3x?'ok':'no',item.within_3x?'WITHIN 3×':'OUTSIDE 3×')]:[bdg('no','EXCLUDED'),bdg('',item.token_status)];
const title=el('h2','d-title',item.name);
title.id='d-title';
const cbtn=btn('btn','Close ×',()=>drawer.close());
cbtn.setAttribute('autofocus','');
const pTit=m.peer_slugs.length?`Category peers (${m.peer_slugs.length}${m.omitted_slug?', omit '+m.omitted_slug:''})`:`No peers in ${cat} — ${m.global_n}-peer prior`;
$('d-body').replaceChildren(dv('d-hd',dv('',dv('row',...sBdgs,bdg('','CONF:'+mo.confidence.toUpperCase()),...(item.flags||[]).map((fl)=>bdg('fl',fl))),title,pg('mut',`${cat} · ${item.slug} · listed: ${item.listed_at||'n/a'} · chains: ${(item.chains||[]).join(', ')||'none'}`),item.reason&&pg('mut',item.reason)),cbtn),box(isP?'LOO vs market cap':'Worked formula (snapshot)',dv('fbox',`TVL (${u(mo.tvl_usd)}) × M_eff (${mx(m.factor,5)}) × G (${mx(g.factor,4)}) × T (${mx(t.factor,4)}) = ${uInt(mo.implied_value_usd)}`),dcRow([['Raw TVL',mo.tvl_usd],['Base (×M_eff)',mo.base_usd],['After G (×G)',mo.after_growth_usd],[isP?'LOO / Mcap':'Implied (×T)',isP?`${u(mo.implied_value_usd)} / ${u(item.mcap_usd)}`:mo.implied_value_usd]])),dv('g3',kvBox('Multiple M_eff',[['Peers / w',`${m.n} (${m.source}) w=${fx(m.shrink_weight)}`],['a_cat / pool',f?`${fx(f.log_intercept,3)} / ${fx(f.pooled_log_intercept,3)}`:'n/a'],['Pivot × size',`${mx(f?f.pivot_multiple:m.multiple)} × ${fx(m.size_factor,3)} (β=${fx(m.beta,3)})`],['v1 / global',`${mx(m.raw_multiple)} / ${mx(m.global_raw_multiple)}`]]),kvBox('Growth G',[['Raw 7d Δ',g.raw_pct!==null?pct(g.raw_pct):'n/a'],['Used [-50,+100]',pct(g.used_pct)+(g.clamped?' (clamp)':'')],['(1+g)^0.5',mx(g.factor,4)]]),kvBox('Age factor T',[['Age',t.imputed?`~${t.used_days}d (${t.source}, n=${t.age_sample_n})`:`${t.age_days}d obs`],['rise / fade',`+${fx(t.rise,3)} / -${fx(t.fade,3)}`],['T factor',mx(t.factor,4)]])),box(pTit,m.peer_slugs.length&&dv('row',...m.peer_slugs.map((ps)=>{
const pr=peerMap.get(ps);
return sp('tag',pr?`${pr.name} ${u(pr.mcap_usd)}/${u(pr.tvl_usd)} (${mx(pr.mcap_usd/pr.tvl_usd,2)})`:ps);
}))),box(`Farm plan · ${fp.family} on ${fp.chain} (${fp.eligibility})`,dcRow([['Capital at risk',`$${fp.capital_at_risk_usd} ($${fp.capital_tiers.join('/$')})`],['Cash: gas + fees',usd2(fp.cash_cost_usd)],[`Opportunity @${fa.opportunity_apr*100}%/yr`,`${usd2(fp.opportunity_cost_usd)} / ${fp.opportunity_horizon_days}d`],['All-in budget',usd2(fp.est_total_cost_usd)]]),dcRow([['Gas (all steps)',usd2(fp.gas_total_usd)],['Fee/slippage reserve',usd2(fp.fee_buffer_total_usd)],[`Contract haircut ${fa.smart_contract_haircut_rate*100}%`,usd2(fp.smart_contract_haircut_usd)],[`Depeg haircut ${fa.depeg_haircut_rate*100}%`,usd2(fp.depeg_haircut_usd)]]),pg('mut',`Setup ${fp.setup_minutes}m; total ${fp.total_active_minutes}m; hold ${fp.hold_weeks}w + ${fp.exit_wait_days_assumed}d exit allowance. Risk haircut ${usd2(fp.risk_haircut_usd)} over ${fp.risk_horizon_days}d.`),el('ol','steps',...fp.steps.map((s)=>el('li','step',sp('snum',s.number),dv('',dv('shd',sp('stit',`[${s.phase.toUpperCase()}] ${s.title}`),sp('smeta',`${usd2(s.all_in_cost_usd)} all-in · ${s.duration_days?s.duration_days+'d/':''}${s.active_minutes}m`)),pg('sact',s.action,sp('ssub',`Tx:${s.transactions} · Gas:${usd2(s.gas_usd)} · Fee:${usd2(s.fee_buffer_usd)}${s.opportunity_cost_usd?" · Opp:"+usd2(s.opportunity_cost_usd):""}${s.risk_haircut_usd?" · Haircut:"+usd2(s.risk_haircut_usd):""}`)))))),pg('mut',`${fp.assumptions} Gas: ${fp.chain} ${usd2(fp.gas_per_tx_usd)}/tx (${fp.gas_known?'table':'fallback'}).`)));
if(!drawer.open)drawer.showModal();
}
function resetFilters(){
st.q='';
st.cat='all';
st.chain='all';
st.minTvl=0;
st.pos=0;
st.watch=0;
go();
}
function render(){
const views={
board:()=>renderBoard($('p-board'),0),
watchlist:()=>renderBoard($('p-watchlist'),1),
peers:()=>renderPeers($('p-peers')),
model:()=>renderModel($('p-model'))
};
for(const t in views){
const onT=st.tab===t;
$('t-'+t).setAttribute('aria-selected',onT?'true':'false');
$('p-'+t).hidden=!onT;
}
$('flt').hidden=st.tab==='model';
$('fq').value=st.q;
$('fcat').value=st.cat;
$('fchn').value=st.chain;
$('ftvl').value=st.minTvl;
press('fpos',st.pos);
$('fwat').disabled=st.tab!=='board';
press('fwat',st.tab==='watchlist'||st.tab==='board'&&st.watch);
views[st.tab]();
}
qsa('[role="tab"]').forEach((b)=>on(b,'click',()=>{
st.tab=b.dataset.t;
go();
}));
[['fq','input','q'],['fcat','change','cat'],['fchn','change','chain'],['ftvl','change','minTvl']].forEach(([id,ev,k])=>on(id,ev,(e)=>{
st[k]=k==='minTvl'?+e.target.value||0:e.target.value;
go();
}));
on('fpos','click',()=>{
st.pos=st.pos?0:1;
go();
});
on('fwat','click',()=>{
if(st.tab==='board'){
st.watch=st.watch?0:1;
go();
}
});
on('frst','click',resetFilters);
const drawer=$('drawer');
on(drawer,'close',()=>{
st.sel=null;
syncHash(1);
qsa('tbody tr[data-sel="true"]').forEach((tr)=>{
tr.dataset.sel='false';
});
});
if(!('closedBy'in HTMLDialogElement.prototype))on(drawer,'click',(e)=>{
const r=drawer.getBoundingClientRect();
if(e.clientX<r.left||e.clientY<r.top||e.clientY>r.bottom)drawer.close();
});
on(window,'keydown',(e)=>{
if(e.key==='/'&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!drawer.open&&!/^(INPUT|SELECT|TEXTAREA)$/.test((document.activeElement||{}).tagName)){
e.preventDefault();
$('fq').focus();
}
});
on(window,'hashchange',()=>{
syncHash(0);
render();
if(st.sel)openDetail(st.sel);else if(drawer.open)drawer.close();
});
syncHash(0);
renderHeader();
render();
if(st.sel)openDetail(st.sel);
})();
