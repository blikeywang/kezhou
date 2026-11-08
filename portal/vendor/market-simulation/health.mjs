export function pipelineHealth(data,now=Date.now()){
 const rows=data.review?.history??[];
 const model=Math.max(data.model?.published??0,...(data.reports??[]).filter(r=>r.origin==='model').map(r=>r.published??0));
 const steps=[
  {key:'execution',label:'交易检查',time:data.account?.lastRun,limit:22*60000,cadence:'目标每 10 分钟'},
  {key:'model',label:'模型研判',time:model,limit:90*60000,cadence:'独立模型提交'},
  {key:'review',label:'小时复核',time:Math.max(0,...rows.map(r=>r.published??0)),limit:90*60000,cadence:'目标每 1 小时'},
  {key:'publication',label:'页面发布',time:data.publishedAt,limit:25*60000,cadence:'目标每 10 分钟'},
 ];
 return steps.map(s=>({...s,healthy:Number.isFinite(s.time)&&s.time>0&&s.time<=now&&now-s.time<=s.limit}));
}
export function pipelineNotice(data,now=Date.now()){
 const steps=pipelineHealth(data,now),execution=steps[0],published=steps[3],notes=[];
 if(published.healthy&&!execution.healthy)notes.push('页面已发布，但交易检查停滞：页面更新时间不代表有新行情或新订单');
 else if(!execution.healthy)notes.push('交易检查比预期晚了');
 if(!published.healthy)notes.push('页面数据还没同步到最新');
 if(data.publication?.executionOutcome==='failure')notes.push('上一轮自动执行失败，账本保持上次结果，会自动重试');
 if(!steps[1].healthy)notes.push('模型研判已停止更新');
 if(!steps[2].healthy)notes.push('小时复核已停止更新：旧绿标不代表当前仍然有效');
 return notes;
}
