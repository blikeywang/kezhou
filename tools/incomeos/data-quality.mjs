import { expectedSession, isTradingDay } from "../scheduler/refresh-runner.mjs";
// Pure quality checks. Retrieval time is never a substitute for source time.
export function sourceTime(row = {}) {
  const raw = row.timestamp ?? row.time ?? row.trade_time;
  const value = typeof raw === 'string' && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? new Date(value < 1e12 ? value * 1000 : value) : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
export function closedSessionDate(rows, now = new Date()) {
  const expected=expectedSession(now);
  return (Array.isArray(rows)?rows:[]).map(x=>String(x.time??'').slice(0,10)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<=expected&&isTradingDay(d)).sort().at(-1)??null;
}
export function assetDataErrors({kind, details = {}, historyResult, price, fundamentals, expectations, quoteTime, expectedDate, now = new Date()}) {
  const errors = [];
  if (historyResult?.error) errors.push(`history: ${historyResult.error}`);
  if (!Array.isArray(historyResult) || historyResult.length < 3) errors.push('history: insufficient source bars');
  if (details.error) errors.push(`research: ${details.error}`);
  for (const name of ['financial','forecast','consensus','valuation']) if (details[name]?.error) errors.push(`${name}: ${details[name].error}`);
  if (!(price > 0)) errors.push('quote: missing valid price');
  errors.push(...timestampErrors(quoteTime, expectedDate, now).map(e => `quote: ${e}`));
  if (kind === 'Stock' && !fundamentals) errors.push('financial: missing fundamentals');
  if (kind === 'Stock' && !expectations) errors.push('expectations: missing forecast and consensus');
  return [...new Set(errors)];
}


// A parseable source time alone does not establish freshness. Keep the session
// policy explicit so tests and offline candidates never depend on wall-clock date.
export function timestampErrors(value, expectedDate, now = new Date()) {
 const parsed=sourceTime({timestamp:value});
 if (!parsed) return ['source timestamp unavailable; freshness unverified'];
 const errors=[];
 if (Date.parse(parsed)>now.getTime()+300_000) errors.push('source timestamp is in the future');
 if (expectedDate) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(parsed)).map(p=>[p.type,p.value]));
  if (`${parts.year}-${parts.month}-${parts.day}` < expectedDate) errors.push('source timestamp predates expected session');
 }
 return errors;
}
export function finalPublicationErrors(data, expectedDate, now = new Date(), {requireOptions = true} = {}) {
 const errors=[...(data?.dataQuality?.errors ?? [])];
 if (!expectedDate || data?.tradingDate!==expectedDate) errors.push('reference session does not match expected completed session');
 const assets=data?.assets ?? [];
 if (!assets.length || assets.length!==data?.universe?.candidateCount || new Set(assets.map(a=>a.symbol)).size!==assets.length) errors.push('asset coverage incomplete');
 for(const asset of assets) errors.push(...timestampErrors(asset.sourceTimestamp, expectedDate, now).map(e=>`${asset.symbol}: ${e}`));
 if(requireOptions) {
  const q=data?.optionDataQuality, rows=data?.options ?? [];
  if(!q || !Number.isInteger(q.scanned) || q.scanned<1 || rows.length!==q.scanned || q.usable!==q.scanned || new Set(rows.map(r=>r.symbol)).size!==rows.length) errors.push('option coverage incomplete');
  errors.push(...(q?.errors ?? []));
  const calendar=q?.eventCalendar;
  if(calendar?.status!=='VERIFIED' || calendar.errors?.length || rows.some(r=>!calendar.coveredSymbols?.includes(r.symbol))) errors.push('option calendar unknown');
  for(const row of rows) for(const side of ['call','put']) {
   const option=row[side];
   if(!option || !Number.isFinite(option.bid)||!Number.isFinite(option.ask)||option.bid<=0||option.ask<option.bid) errors.push(`${row.symbol} ${side}: invalid two-sided market`);
   errors.push(...timestampErrors(option?.quoteTimestamp,expectedDate,now).map(e=>`${row.symbol} ${side} quote: ${e}`));
   errors.push(...timestampErrors(option?.depthTimestamp,expectedDate,now).map(e=>`${row.symbol} ${side} depth: ${e}`));
  }
 }
 return [...new Set(errors)];
}
export function applyFinalPublicationQuality(data, expectedDate, now = new Date(), options) {
 const errors=finalPublicationErrors(data,expectedDate,now,options);
 data.dataQuality={...data.dataQuality, publicationReady:errors.length===0, publicationErrors:errors};
 data.mode=errors.length?'partial':'live';
 return attachStructuredQuality(data);
}

// Additive machine-readable disclosures; legacy strings remain unchanged.
export function structuredQualityIssues(data) {
 const entries=new Map();
 function add(symbol,field,code,scope){const key=JSON.stringify([symbol,field,code]);const old=entries.get(key);if(old){if(!old.scopes.includes(scope))old.scopes.push(scope);}else entries.set(key,{symbol,field,code,scopes:[scope]});}
 function decode(message,scope,fallbackSymbol=null,fallbackField='publication'){
  const text=String(message);const match=text.match(/^([A-Z][A-Z0-9.]*)\s*(call|put)?(?:\s+(quote|depth))?:\s*(.*)$/);
  let symbol=fallbackSymbol,field=fallbackField,body=text;
  if(match){symbol=match[1].replace(/\.US$/,'');field=match[3]??(match[2]?'option':'quote');body=match[4];if(match[2])field=`${match[2]}.${field}`;}
  const prefix=body.match(/^(history|research|financial|forecast|consensus|valuation|quote|expectations):\s*(.*)$/);
  if(prefix){field=prefix[1];body=prefix[2];}
  const code=/source timestamp unavailable/.test(body)?'SOURCE_TIME_MISSING':/source timestamp is in the future/.test(body)?'SOURCE_TIME_FUTURE':/source timestamp predates/.test(body)?'SOURCE_TIME_STALE':/failed|unavailable|REQUEST_|RATE_LIMITED|AUTHORIZATION_FAILED/.test(body)?'SOURCE_REQUEST_FAILED':/coverage incomplete/.test(body)?'COVERAGE_INCOMPLETE':/calendar unknown/.test(body)?'CALENDAR_UNVERIFIED':/reference.*session/.test(body)?'SESSION_MISMATCH':/invalid two-sided/.test(body)?'INVALID_TWO_SIDED_MARKET':/missing|insufficient/.test(body)?'DATA_MISSING':'QUALITY_CHECK_FAILED';
  add(symbol,field,code,scope);
 }
 for(const error of data.dataQuality?.errors??[])decode(error,'research');
 for(const error of data.dataQuality?.publicationErrors??[])decode(error,'publication');
 for(const error of data.optionDataQuality?.errors??[])decode(error,'options',null,'option');
 for(const asset of data.executionAssets??[])if(!sourceTime({timestamp:asset.quoteTimestamp}))add(asset.symbol.replace(/\.US$/,''),'quote','SOURCE_TIME_MISSING','execution');
 return [...entries.values()];
}
export function attachStructuredQuality(data) {
 data.dataQuality={...data.dataQuality,issues:structuredQualityIssues(data)};
 return data;
}
