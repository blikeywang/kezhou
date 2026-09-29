// Display exchange evidence separately from the simulator's execution price source.
export function flowFresh(stream, now=Date.now()){
  return stream?.status==='ok'&&Number.isFinite(stream.through)&&now>=stream.through&&now-stream.through<=20*60000;
}
export function renderFlow(bundle, ui){
  const {E,fmt,dt,badge,empty,lineChart}=ui;
  if(!bundle?.assets?.length)return empty('BTC / ETH 资金流尚未发布；小时复核不应将缺失值视为零。');
  const signed=(v,unit='')=>Number.isFinite(v)?(v>0?'+':'')+fmt(v,3)+(unit?' '+unit:''):'—';
  const state=s=>({candidate:'背离候选',confirmed:'后续结构已确认',invalidated:'已失效',expired:'未确认，已过期'}[s]??s);
  let html='<div class="ms-row"><div><h2>BTC / ETH · CVD 与 OI</h2><p>主动买卖、增减仓与价格结构一起看。每小时供模型复核，图表随公开快照更新。</p></div>'+badge('5M 完整统计 · 预留 5 分钟结算')+'</div>';
  html+='<p class="ms-inline-note">'+E(bundle.interpretation)+' CVD = 累计主动买量 − 主动卖量。现货与永续分别统计；背离标记是观察条件，实际入场与保护价见交易计划。</p>';
  for(const asset of bundle.assets){
    html+='<section class="ms-detail-section ms-flow-asset"><h3>'+E(asset.symbol)+' · 资金流与价格</h3><div class="ms-two">';
    for(const key of ['spot','perpetual']){
      const s=asset[key],fresh=flowFresh(s),w=s?.windows??{};
      html+='<article class="ms-card"><div class="ms-card-head"><h4>'+(key==='spot'?'现货 CVD':'永续 CVD + OI')+'</h4>'+badge(fresh?'数据可用':s?.status==='unavailable'?'数据缺失':'数据滞后',fresh?'good':'warn')+'</div>';
      if(!s?.series?.length){html+=empty('本轮未取得数据；不以估算值替代。')+'</article>';continue;}
      if(s.volumeCheck?.mismatchBars)html+='<p>'+badge('部分主动量与K线量口径不一致','warn')+'</p>';
      html+='<p class="ms-source">'+E(s.scope)+'<br>完整区间截至 '+dt(s.through)+' · UTC+8</p><div class="ms-table-wrap"><table class="ms-table"><thead><tr><th>窗口</th><th>ΔCVD · '+E(asset.symbol)+'</th><th>价格变化</th>'+(key==='perpetual'?'<th>ΔOI · 币数量</th>':'')+'</tr></thead><tbody>';
      for(const period of ['15m','1h','4h']){
        const item=w[period];html+='<tr><td>'+period+'</td><td>'+signed(item?.delta)+'</td><td>'+signed(item?.pricePct,'%')+'</td>'+(key==='perpetual'?'<td>'+signed(item?.oiPct,'%')+'</td>':'')+'</tr>';
      }
      html+='</tbody></table></div>';
      if(key==='perpetual')html+='<p class="ms-chart-caption">1H 联合状态：'+E(w['1h']?.oiState??'OI 数据不足')+'。OI 不能单独判断新增的是多头还是空头。</p>';
      const rows=s.series.slice(-49);
      html+='<h4 class="ms-flow-chart-title">价格 · '+E(s.instrument)+' / USDT</h4>'+lineChart(rows.map(r=>({...r,value:r.close})),[],'近4小时 '+asset.symbol+' 价格')+'<h4 class="ms-flow-chart-title">CVD · '+E(asset.symbol)+'</h4>'+lineChart(rows.map(r=>({time:r.time,value:r.cvd})),[],'近4小时 '+asset.symbol+' CVD');
      if(key==='perpetual'){
        // Do not connect a chart across a missing OI observation.
        if(rows.every(r=>Number.isFinite(r.oi)))html+='<h4 class="ms-flow-chart-title">OI · '+E(asset.symbol)+' 数量</h4>'+lineChart(rows.map(r=>({time:r.time,value:r.oi})),[],'近4小时 '+asset.symbol+' 币本位OI');
        else html+=empty('OI 序列有缺口，暂不连线绘图。有效区间变化仍在上表列出。');
      }
      html+='<p class="ms-chart-caption">CVD 锚点 '+dt(s.fromTime)+'；'+E(s.anchorPolicy)+'。图表使用相同的近 4 小时时间轴。</p>';
      const events=s.divergences??[];
      html+='<h4>最近区间背离</h4>'+(events.length?'<div class="ms-checks">'+[...events].reverse().map(e=>'<div class="ms-check"><header>'+badge(fresh?state(e.status):'历史信号 · 数据滞后',fresh&&e.status==='confirmed'?'good':'warn')+'<strong>'+E(e.label)+'</strong></header><p>发现 '+dt(e.observedAt)+' · 参照区间'+(e.kind==='bullish'?'低点 ':'高点 ')+fmt(e.referencePrice)+'<br>后续收盘'+(e.kind==='bullish'?'突破 ':'跌破 ')+fmt(e.confirmationPrice)+' 才算结构确认；收盘越过 '+fmt(e.invalidationPrice)+' 失效。'+(e.confirmedAt?'<br>确认 '+dt(e.confirmedAt):'')+(e.invalidatedAt?'<br>失效 '+dt(e.invalidatedAt):'')+'</p></div>').join('')+'</div>':empty(fresh?'当前完整样本没有满足定义的背离。':'数据过期，不生成新背离信号。'));
      html+='<p class="ms-source">'+E((s.notes??[]).join(' '))+(s.volumeCheck?'<br>永续主动量与K线总量检查：'+s.volumeCheck.mismatchBars+' / '+s.volumeCheck.checkedBars+' 根差异超过 1%。':'')+'</p></article>';
    }
    html+='</div></section>';
  }
  return html+'<p class="ms-source">来源：<a href="https://www.okx.com/docs-v5/en/" target="_blank" rel="noopener noreferrer">OKX 公开统计接口 ↗</a> · 本快照采集 '+dt(bundle.generatedAt)+' · 证据编号 '+E(bundle.evidenceId)+'<br>小时复核单独冻结其读取的数据，复核摘要中的证据编号可能与本轮网页快照不同。图上信号不代表已成交。</p>';
}
