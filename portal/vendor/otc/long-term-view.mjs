import {evaluateLongTerm,validateBook} from './long-term-engine.mjs';
const $=id=>document.getElementById(id);
const tag=(name,text,cl)=>{const n=document.createElement(name);if(text!=null)n.textContent=text;if(cl)n.className=cl;return n;};
const num=v=>new Intl.NumberFormat('en-US',{maximumFractionDigits:6}).format(v);
export function mountLongTerm(selectAsset){
 let book=null,failed=false,last=null;
 async function refresh(){
  try{const res=await fetch('./data/long-term-levels.json',{cache:'no-cache',signal:AbortSignal.timeout(10000)});if(!res.ok)throw Error('HTTP '+res.status);const tmp=validateBook(await res.json());book=tmp;failed=false;}
  catch{failed=true;}last=null;
 }
 function render(snapshot,prices,asOf){
  if(last&&last[0]===snapshot&&last[1]===prices&&last[2]===asOf)return;
  last=[snapshot,prices,asOf];const tableBox=$('lt-table'),summary=$('lt-summary'),source=$('lt-source'),v=$('lt-edition');
  tableBox.replaceChildren();source.replaceChildren();
  if(failed||!book){v.textContent='资料未载入';summary.textContent='暂时无法核验远期价位资料，不判断触价或双条件。';return;}
  const result=evaluateLongTerm(book,snapshot,prices,asOf);
  if(!result.edition){v.textContent='观察截至 '+asOf;summary.textContent='截至 '+asOf+' 尚无已公布的远期谢林点，不展示后来的价位。';return;}
  const e=result.edition;v.textContent=e.date+' 版 · '+result.rows.length+' 个价位';
  const touched=result.rows.filter(r=>r.priceState==='touched').length;
  const covered=result.rows.filter(r=>r.bar).length;
  summary.textContent=(result.active?'已按有来源的判据核查。':'节点改善口径待作者说明：仅标记触价，不发双条件提醒。')+' 观察截至 '+asOf+'；'+(covered?'当日可核对 '+covered+'/'+result.rows.length+' 项，其中触价 '+touched+' 项。':'当日暂无可判定触价的完整日 K。');
  const table=tag('table',null,'lt-table');table.setAttribute('aria-label','远期谢林点及验证状态');const h=table.createTHead().insertRow();for(const x of ['标的 / 行情口径','远期点位','触价核对','双条件提醒']){const th=tag('th',x);th.scope='col';h.append(th);}
  const body=table.createTBody();for(const r of result.rows){
   const tr=body.insertRow();const name=tr.insertCell();const pick=tag('button',r.label,'lt-pick');pick.type='button';pick.setAttribute('aria-label','在日线图查看'+r.label);pick.onclick=()=>{selectAsset(r.id);$('assetSelect').focus();};name.append(pick);
   name.append(tag('small',r.priceRef?(r.priceRef.provider==='binance'?'Binance 现货 ':'美股正规时段 ')+r.priceRef.symbol+' · '+r.priceRef.currency:'来源未指定可比报价 · 不用代理'));
   const level=tr.insertCell();level.className='lt-level';level.textContent=num(r.value);
   const st=tr.insertCell();st.dataset.label='触价';const labels={unmapped:'行情品种待核',unavailable:'已收盘行情不可用',before_first_full_bar:'等待发布后的完整日 K',no_bar:'该日无已收盘日 K',touched:'已触价',not_touched:'当日未触价'};
   st.append(tag('span',labels[r.priceState],'lt-state'+(r.priceState==='touched'?' lt-touch':'')));
   if(r.bar)st.append(tag('small',r.bar.date+' · 低 '+num(r.bar.low)+' / 高 '+num(r.bar.high)));
   else if(r.lastAvailable)st.append(tag('small','最近可用日 K：'+r.lastAvailable));
   if(r.lastTouch&&r.lastTouch.date!==r.bar?.date)st.append(tag('small','上次触价：'+r.lastTouch.date));
   const note=tr.insertCell();note.dataset.label='提醒';note.append(tag('span',r.event?'双条件首次确认 · '+r.event.date:!result.active?'未启用 · 判据待说明':'尚无已确认双条件',r.event?'lt-confirm':''));
   if(r.candidate)note.append(tag('small','当日负转正仅为跨缺页候选'));
   else if(r.nodes.length)note.append(tag('small','最近确认负转正：'+r.nodes.at(-1).date));
  }
  tableBox.append(table);const link=tag('a','查看本期原页');link.href=e.source;link.target='_blank';link.rel='noopener noreferrer';
  source.append(link,document.createTextNode(' · 高低区间含该价位才记触价，只使用公布后完整日期的具名日 K。缺行情不判未触价；跨缺页不确认节点。长期价位与“今日潜力观察”分开。'));
 }
 return {refresh,render};
}
