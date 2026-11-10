import { sourceTime, timestampErrors, finalPublicationErrors } from './data-quality.mjs';
export const RESEARCH_UNIVERSE = ["SPY.US", "QQQ.US", "IWM.US", "DIA.US", "SCHD.US", "VIG.US", "JEPI.US", "JEPQ.US", "QQQI.US", "SPYI.US", "DIVO.US", "DGRO.US", "VYM.US", "TLT.US", "SGOV.US", "KO.US", "PEP.US", "PG.US", "JNJ.US", "ABBV.US", "MRK.US", "PFE.US", "XOM.US", "CVX.US", "O.US", "VZ.US", "T.US", "MO.US", "PM.US", "HD.US", "LOW.US", "JPM.US", "BAC.US", "MCD.US", "NEE.US", "AAPL.US", "MSFT.US", "NVDA.US", "GOOGL.US", "META.US", "AMZN.US", "AVGO.US", "AMD.US", "TSLA.US", "NFLX.US", "COST.US", "ORCL.US", "CRM.US", "MU.US", "COIN.US", "GS.US", "BRK.B.US", "V.US", "MA.US", "BLK.US", "CME.US", "MS.US", "WFC.US", "LLY.US", "UNH.US", "AMGN.US", "WMT.US", "LIN.US", "CAT.US", "ETN.US", "ADP.US", "TXN.US", "QCOM.US", "ACN.US", "COP.US", "PGR.US"];
export const RESEARCH_NOTICE = '仅供模型研究与反馈；来源时间未知或未核实，不能作为实时可执行行情，不生成买卖订单。';
export function researchPublicationErrors(data, expectedDate, now = new Date(), { manual = false } = {}) {
 const errors=[];
 if(!manual) errors.push('explicit manual research publication required');
 if(!expectedDate || data?.tradingDate!==expectedDate) errors.push('reference session must match latest completed session');
 const generated=Date.parse(data?.asOf),age=now.getTime()-generated;
 if(!Number.isFinite(generated)||age< -300000||age>86400000) errors.push('generation time invalid or older than 24 hours');
 const assets=data?.assets??[];
 if(data?.universe?.candidateCount!==71||assets.length!==71||new Set(assets.map(x=>x.symbol)).size!==71||assets.some(x=>!RESEARCH_UNIVERSE.includes(x.symbol))) errors.push('original 71-asset universe must remain visible');
 if(assets.some(x=>!Number.isFinite(x.price)||x.price<=0||!Number.isFinite(x.history?.months)||x.history.months<3)) errors.push('missing price or insufficient history for research calculations');
 const times=[...assets.map(x=>x.sourceTimestamp),...(data?.executionAssets??[]).map(x=>x.quoteTimestamp),...(data?.options??[]).flatMap(x=>['call','put'].flatMap(s=>[x[s]?.quoteTimestamp,x[s]?.depthTimestamp]))];
 if(times.some(t=>{const s=sourceTime({timestamp:t});return s&&Date.parse(s)>now.getTime()+300000;})) errors.push('future source time anomaly; do not publish');
 if(!data?.dataQuality||!Array.isArray(data.dataQuality.errors)||!data?.optionDataQuality||!Array.isArray(data.optionDataQuality.errors)) errors.push('quality disclosures missing');
 if(!data?.portfolio?.weights?.length||!Array.isArray(data.options)) errors.push('research output incomplete');
 return errors;
}
function timeDisclosure(value, expectedDate, now) {
 const timestamp=sourceTime({timestamp:value});
 const issues=timestampErrors(timestamp,expectedDate,now);
 return {timestamp,status:timestamp?(issues.length?'stale_or_invalid':'observed_not_execution_verified'):'unknown',issues};
}
export function prepareResearchPublication(data, expectedDate, now = new Date(), options = {}) {
 const blockers=researchPublicationErrors(data,expectedDate,now,options);
 if(blockers.length) throw new Error(`Research publication blocked: ${blockers.join('; ')}`);
 const result=structuredClone(data);
 result.mode='partial';result.publicationMode='research_partial';result.executionAllowed=false;
 result.researchNotice=RESEARCH_NOTICE;
 result.researchPreparedAt=now.toISOString();
 result.dataQuality={...result.dataQuality,publicationReady:false,researchPublicationReady:true,publicationErrors:finalPublicationErrors(data,expectedDate,now)};
 result.sourceTimePolicy={generation:'asOf is computation time, not source time',reference:'tradingDate is a completed SPY session reference, not per-asset quote freshness',financial:'report period is preserved; retrieval does not verify source publication time',market:'market temperature source publication time unknown',history:'monthly series may include a forming month; historyDataThrough is separate',execution:'quote and depth times must be independently sourced; retrieval times are never substituted'};
 for(const asset of result.assets) asset.researchSourceTime=timeDisclosure(asset.sourceTimestamp,expectedDate,now);
 for(const asset of result.executionAssets??[]) {asset.executionAllowed=false;asset.researchSourceTime=timeDisclosure(asset.quoteTimestamp,expectedDate,now);}
 for(const row of result.options) {
  row.executionAllowed=false;
  for(const side of ['call','put']) if(row[side]) {
   const option=row[side];option.researchAction=option.researchAction??option.action;option.action='RESEARCH_ONLY';option.executionAllowed=false;
   option.researchSourceTime={quote:timeDisclosure(option.quoteTimestamp,expectedDate,now),depth:timeDisclosure(option.depthTimestamp,expectedDate,now)};
   option.gates=[...new Set([RESEARCH_NOTICE,...(option.gates??[])])];
  }
 }
 result.limitations=[...new Set([RESEARCH_NOTICE,...(result.limitations??[])])];
 return result;
}
