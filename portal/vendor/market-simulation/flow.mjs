// 1H structure comparisons share one continuous CVD anchor and same-bar OI.
const HOUR=3600000, choices=new Map(), displayed=new Map();
export function flowFresh(stream,now=Date.now()){
  const limit=stream?.intervalMs===HOUR?80*60000:20*60000;
  return stream?.status==='ok'&&Number.isFinite(stream.through)&&now>=stream.through&&now-stream.through<=limit;
}
export function compareFlowPoints(a,b,kind='low'){
  if(!a||!b||a.time>=b.time||a.cvdAnchor!==b.cvdAnchor)return {comparable:false,label:'A/B 时间先后无效、缺少数据，或跨越了 CVD 数据缺口。'};
  const priceA=a[kind],priceB=b[kind],priceChange=priceB-priceA,cvdChange=b.cvd-a.cvd;
  let signal='none',label='这两个时间点未满足 CVD 背离关系';
  if(kind==='low'&&priceChange>=0&&cvdChange<0){signal='bullish_absorption';label='价格低点未下移，CVD 低于 A 点对应值';}
  if(kind==='low'&&priceChange<0&&cvdChange>0){signal='bullish_exhaustion';label='价格低点下移，CVD 高于 A 点对应值';}
  if(kind==='high'&&priceChange<=0&&cvdChange>0){signal='bearish_absorption';label='价格高点未上移，CVD 高于 A 点对应值';}
  if(kind==='high'&&priceChange>0&&cvdChange<0){signal='bearish_exhaustion';label='价格高点上移，CVD 低于 A 点对应值';}
  const oi=Number.isFinite(a.oi)&&a.oi>0&&Number.isFinite(b.oi);
  return {comparable:true,signal,label,priceA,priceB,cvdChange,oiChange:oi?b.oi-a.oi:null,oiChangePct:oi?(b.oi/a.oi-1)*100:null,elapsedHours:(b.time-a.time)/HOUR};
}
export function updateFlowChoice(key,field,value){
  if(!['a','b','kind'].includes(field)||!displayed.has(key))return;
  const next={...displayed.get(key),[field]:field==='kind'?value:Number(value)};
  choices.set(key,next);
}
export function renderFlow(bundle,ui){
  const {E,fmt,dt,badge,empty,lineChart}=ui;
  if(!bundle?.assets?.length)return empty('BTC / ETH 资金流尚未发布；缺失值不能视为零。');
  const signed=(v,unit='')=>Number.isFinite(v)?(v>0?'+':'')+fmt(v,3)+(unit?' '+unit:''):'—';
  const labels={pivot_pending:'B 拐点待确认',divergence:'拐点已确认 · 存在背离',breakout:'背离后突破区间结构',invalidated:'后续已突破 B 点极值',data_gap:'后续数据有缺口',no_divergence:'未见背离'};
  let html='<div class="ms-row"><div><h2>BTC / ETH · 1H 拐点与资金流</h2><p>比较两个价格拐点，以及同一根 1H K 线对应的 CVD 和 OI；A、B 可以相隔数日。</p></div>'+badge('1H 结构 · 每小时复核')+'</div>';
  html+='<p class="ms-inline-note">前低 A → 后低 B：若价格守住 A，而 B 对应的 CVD 更低，记录为吸收候选。OI 对比同样读取 A、B 时点存量，辅助解释增减仓。现货与永续分别观察。</p>';
  for(const asset of bundle.assets){
    html+='<section class="ms-detail-section ms-flow-asset"><h3>'+E(asset.symbol)+' · 两点对照</h3><div class="ms-two">';
    for(const type of ['spot','perpetual']){
      const s=asset[type],h=s?.hourly,key=asset.symbol+':'+type,rows=h?.series??[],fresh=flowFresh(h);
      html+='<article class="ms-card"><div class="ms-card-head"><h4>'+(type==='spot'?'现货 CVD · 同刻永续 OI':'永续 CVD + OI')+'</h4>'+badge(fresh?'1H 数据可用':rows.length?'1H 数据滞后':'1H 数据不足',fresh?'good':'warn')+'</div>';
      if(!rows.length){html+=empty('本轮未取得连续 1H 历史；不沿用旧的 4 小时区间背离规则。')+'</article>';continue;}
      html+='<p class="ms-source">'+E(s.scope)+'<br>1H 完整数据截至 '+dt(h.through)+' · UTC+8<br>覆盖 '+dt(h.fromTime,true)+' — '+dt(h.through,true)+'</p>';
      const pairs=h.comparisons??[],def=[...pairs].reverse().find(p=>p.kind==='low'&&p.signal!=='none'&&['pivot_pending','divergence','breakout'].includes(p.status))??pairs.at(-1);
      const selected=choices.get(key)??{a:def?.a.time??rows[Math.max(0,rows.length-49)].time,b:def?.b.time??rows.at(-1).time,kind:def?.kind??'low'};
      displayed.set(key,selected);
      const a=rows.find(r=>r.time===selected.a),b=rows.find(r=>r.time===selected.b),comparison=compareFlowPoints(a,b,selected.kind);
      const pair=pairs.find(p=>p.a.time===selected.a&&p.b.time===selected.b&&p.kind===selected.kind);
      const pointOptions=selectedTime=>[...(rows.some(r=>r.time===selectedTime)?[]:['<option selected value="'+selectedTime+'">所选点已超出本轮历史覆盖</option>']),...[...rows].reverse().map(r=>'<option value="'+r.time+'"'+(r.time===selectedTime?' selected':'')+'>'+E(dt(r.time-HOUR,true))+' · '+fmt(r[selected.kind])+'</option>')].join('');
      html+='<div class="ms-flow-select"><label>比较结构<select data-flow-key="'+key+'" data-flow-field="kind"><option value="low"'+(selected.kind==='low'?' selected':'')+'>低点 → 低点</option><option value="high"'+(selected.kind==='high'?' selected':'')+'>高点 → 高点</option></select></label><label>A · 1H 开始时间<select data-flow-key="'+key+'" data-flow-field="a">'+pointOptions(selected.a)+'</select></label><label>B · 1H 开始时间<select data-flow-key="'+key+'" data-flow-field="b">'+pointOptions(selected.b)+'</select></label></div>';
      html+='<p class="ms-chart-caption">可手动指定两根 1H 柱。'+E(h.samplePolicy)+'</p>';
      if(!comparison.comparable){html+=empty(comparison.label)+'</article>';continue;}
      html+='<div class="ms-check"><header>'+badge(pair?(labels[pair.status]??pair.status):'手动两点比较，未认证拐点',pair?.status==='divergence'&&fresh?'good':'warn')+'</header><p>'+E(comparison.label)+'。间隔 '+fmt(comparison.elapsedHours)+' 小时。</p></div>';
      html+='<div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>同一时点数据</th><th>A</th><th>B</th></tr></thead><tbody><tr><td>1H 开始</td><td>'+dt(a.time-HOUR,true)+'</td><td>'+dt(b.time-HOUR,true)+'</td></tr><tr><td>CVD / OI 取样</td><td>'+dt(a.time,true)+'</td><td>'+dt(b.time,true)+'</td></tr><tr><td>价格'+(selected.kind==='low'?'低点':'高点')+'</td><td>'+fmt(comparison.priceA)+'</td><td>'+fmt(comparison.priceB)+'</td></tr><tr><td>CVD · '+E(asset.symbol)+'</td><td>'+fmt(a.cvd,3)+'</td><td>'+fmt(b.cvd,3)+'</td></tr>'+'<tr><td>永续 OI · '+E(asset.symbol)+'</td><td>'+fmt(a.oi,3)+'</td><td>'+fmt(b.oi,3)+'</td></tr>'+'</tbody></table></div><p class="ms-chart-caption">B − A：CVD '+signed(comparison.cvdChange,asset.symbol)+'；OI '+signed(comparison.oiChange,asset.symbol)+'（'+signed(comparison.oiChangePct,'%')+'）'+'。</p>';
      const points=rows.filter(r=>r.cvdAnchor===a.cvdAnchor&&r.time>=a.time-3*HOUR&&r.time<=b.time+6*HOUR).map(r=>({...r,pointLabel:r.time===a.time?'A':r.time===b.time?'B':''}));
      html+='<h4 class="ms-flow-chart-title">价格 · 1H / USDT</h4>'+lineChart(points.map(r=>({...r,value:r.close,markValue:r[selected.kind]})),[],'1H价格拐点 A 与 B',true,800)+'<h4 class="ms-flow-chart-title">连续 CVD · '+E(asset.symbol)+'</h4>'+lineChart(points.map(r=>({...r,value:r.cvd})),[],'同一CVD曲线上的 A 与 B',false,800);
      {
        html+='<h4 class="ms-flow-chart-title">OI · '+E(asset.symbol)+' 数量</h4>';
        html+=points.every(r=>Number.isFinite(r.oi))?lineChart(points.map(r=>({...r,value:r.oi})),[],'A与B对应时点的OI',false,800):empty('所示区间 OI 有缺口，暂不连线；A/B 有效时点值仍列于表内。');
      }
      html+='<p class="ms-chart-caption">两点共用 CVD 锚点 '+dt(a.cvdAnchor)+'。各图使用相同时间轴，圆点 A / B 对应上表；取样为该小时收盘。'+(pair?.b.pivotConfirmedAt?'B 拐点于 '+dt(pair.b.pivotConfirmedAt)+' 确认。':'')+'</p>';
      if(pair?.structurePrice)html+='<p class="ms-chart-caption">A/B 之间的'+(selected.kind==='low'?'反弹高点':'回落低点')+' '+fmt(pair.structurePrice)+'，供判断后续结构；不自动改成止盈或进场价。'+(pair.breakoutAt?' 后续收盘突破于 '+dt(pair.breakoutAt)+'。':'')+(pair.invalidatedAt?' B 价格极值于 '+dt(pair.invalidatedAt)+' 被突破。':'')+'</p>';
      html+='<details class="ms-flow-context"><summary>近期窗口变化（辅助背景）</summary><div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>窗口</th><th>ΔCVD</th><th>ΔOI · 币数量</th></tr></thead><tbody>'+['15m','1h','4h'].map(period=>'<tr><td>'+period+'</td><td>'+signed(s.windows?.[period]?.delta)+'</td><td>'+signed(s.windows?.[period]?.oiPct,'%')+'</td></tr>').join('')+'</tbody></table></div><p class="ms-source">以上为短时增量，不用于替代 A/B 的累计 CVD 和当时 OI。</p></details>';
      html+='<p class="ms-source">'+E(h.oiScope)+' '+E(h.anchorPolicy)+' '+E(h.pivotPolicy)+' '+E(h.coverageNote)+'<br>'+E((s.notes??[]).join(' '))+'</p></article>';
    }
    html+='</div></section>';
  }
  return html+'<p class="ms-source">来源：<a href="https://www.okx.com/docs-v5/en/" target="_blank" rel="noopener noreferrer">OKX 公开统计 ↗</a>。'+E(bundle.interpretation)+'<br>本快照采集 '+dt(bundle.generatedAt)+' · 证据编号 '+E(bundle.evidenceId)+'。小时模型另行冻结其当时使用的证据，编号可能与页面最新快照不同。</p>';
}
