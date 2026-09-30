// Present original review text in separate boxes without changing its verdicts.
import {escape as E, PAIRS, tradeHorizonOf} from './model.mjs';

export function reviewFresh(review, now=Date.now()) {
  return Number.isFinite(review?.published) && review.published<=now && now-review.published<=90*60000;
}

export function reviewSections(text) {
  const value=String(text??'').trim();
  if(!value)return [];
  const explicit=[...value.matchAll(/【([^】\n]{1,30})】/g)];
  const markers=(explicit.length?explicit:[...value.matchAll(/(?:^|[。\n])\s*(BTC|ETH|XAU|XAG|NQ|CL)\s*[：:]/g)]).map(m=>({title:m[1],start:m.index+(!explicit.length&&/^[。\n]/.test(m[0])?1:0),bodyStart:m.index+m[0].length}));
  const sections=[];
  if(markers.length) {
    const prefix=value.slice(0,markers[0].start).trim();
    if(prefix)sections.push({title:'复核总览',text:prefix});
    markers.forEach((m,i)=>{
      // A punctuation boundary belongs to the preceding prose, not the title.
      const start=m.bodyStart,end=markers[i+1]?.start??value.length;
      const body=value.slice(start,end).trim();
      if(body)sections.push({title:m.title,text:body});
    });
  } else sections.push({title:'复核总览',text:value});
  return sections;
}

export function reviewTarget(check, data) {
  const pair=check.book==='pair';
  const records=pair?[...(data.pairs?.account?.trades??[]),...(data.pairs?.reports??[]),...(data.pairs?.pendingPlans??[])]:[...(data.account?.trades??[]),...(data.reports??[]),...(data.pendingPlans??[])];
  const record=records.find(r=>r.id===check.id);
  const keys=pair?Object.keys(PAIRS):['BTC','ETH','XAU','XAG','NQ','CL'];
  const key=record?.pair??record?.symbol??keys.find(k=>String(check.id).split(':').includes(k));
  return {name:key?(pair?PAIRS[key]??key:key):pair?'组合交易':'单标的交易',
          horizon:record?(pair?record.horizon??'10M':tradeHorizonOf(record)):pair?'10M':String(check.id).match(/:(10M|1H|4H|1D|1W)(?=:|$)/)?.[1]??'周期见原记录'};
}

const prose=text=>String(text).split(/\n+|(?<=。)/).map(t=>t.trim()).filter(Boolean).map(t=>'<p>'+E(t)+'</p>').join('');
const boxes=(text,extra='')=>'<div class="ms-review-topics '+extra+'">'+reviewSections(text).map(s=>'<section class="ms-review-topic"><h4>'+E(s.title)+'</h4><div class="ms-review-copy">'+prose(s.text)+'</div></section>').join('')+'</div>';

export function renderReviewCards(data, ui) {
  const {dt,badge,empty}=ui,now=ui.now??Date.now();
  const audits=[...(data.review?.history??[])].sort((a,b)=>b.published-a.published);
  const gates=(data.review?.gates??[]).filter((g,i,a)=>i===a.findLastIndex(x=>x.book===g.book&&x.key===g.key&&x.horizon===g.horizon)).filter(g=>g.verdict==='suspended');
  let html='<div class="ms-row"><div><h2>模型复核</h2><p>逐项查看判断、依据和恢复条件。绿标表示该次审查认可依据与风险控制。</p></div>'+badge(data.review?.schedule?.enabled?'已配置小时复核':'复核日程待确认',data.review?.schedule?.enabled?'':'warn')+'</div>';
  const last=audits[0],fresh=reviewFresh(last,now);
  html+='<div class="ms-review-clocks"><section><small>十分钟交易检查</small><b>'+dt(data.cloud?.lastScheduledSuccess??data.account?.lastRun)+'</b></section><section><small>最近模型复核</small><b>'+dt(last?.published)+'</b>'+badge(fresh?'记录可用':'等待新的复核',fresh?'good':'warn')+'</section><section><small>公开页面同步</small><b>'+dt(data.publishedAt)+'</b></section></div>';
  if(!fresh)html+='<p class="ms-notice warn">'+(last?'最近复核已经过期，下面展示历史判断；旧绿标不代表当前已经通过审查。':'尚未收到实际模型复核结果。')+'</p>';
  html+='<p class="ms-inline-note">BTC / ETH 按 1H 价格拐点 A/B 比较连续 CVD 与同期 OI。<button data-tab="flow">查看 CVD / OI 图表 ↗</button></p>';
  if(gates.length)html+='<details class="ms-review-gates"><summary>当前新入场挂起范围 · '+gates.length+' 项</summary><div class="ms-review-grid">'+gates.map(g=>'<section class="ms-review-topic"><h4>'+E(g.key)+' · '+E(g.horizon)+'</h4>'+badge('新入场挂起','warn')+prose(g.reason)+'</section>').join('')+'</div></details>';
  if(!audits.length)return html+empty('尚无模型复核记录');
  return html+audits.map((r,i)=>{
    const checks=r.checks??[],current=i===0&&fresh;
    let body=boxes(r.summary);
    body+='<h4 class="ms-review-group-title">交易与计划 · '+checks.length+' 项</h4><div class="ms-review-grid">'+checks.map(c=>{
      const target=reviewTarget(c,data),green=c.verdict==='green';
      return '<article class="ms-review-check '+(green?'green':'suspended')+'"><header><div><h4>'+E(target.name)+'</h4><small>'+E(target.horizon)+' · '+(c.kind==='trade'?'持仓 / 成交':'入场计划')+'</small></div>'+badge((green?'✓ 合理':'! 挂起')+(current?'':' · 当时结论'),green&&current?'good':'warn')+'</header>'+boxes(c.reason,'ms-review-reasons')+'<details class="ms-review-reference"><summary>原始记录编号</summary><code>'+E(c.id)+'</code></details></article>';
    }).join('')+'</div><details class="ms-review-reference"><summary>快照与原始复核记录</summary><p>检查快照 '+dt(r.snapshotRun)+' · 复核编号 '+E(r.id)+'<br>结果校验 '+E(r.hash?.slice(0,16))+'</p><p class="ms-prose">'+E(r.summary)+'</p></details>';
    const heading='<div class="ms-review-heading"><div><h3>'+dt(r.published)+'</h3><small>'+E(i===0?'最近一轮':'历史复核')+'</small></div><span>'+badge('✓ '+checks.filter(c=>c.verdict==='green').length+' 项合理',current?'good':'')+' '+badge('! '+checks.filter(c=>c.verdict==='suspended').length+' 项挂起','warn')+'</span></div>';
    return i===0?'<article class="ms-card ms-review">'+heading+body+'</article>':'<details class="ms-card ms-review ms-review-history"><summary>'+heading+'</summary>'+body+'</details>';
  }).join('');
}
