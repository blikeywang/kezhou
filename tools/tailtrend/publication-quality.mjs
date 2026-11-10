import {createHash} from 'node:crypto';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
export function assertTailtrendQuality(snapshot, expectedDate, {persisted = false} = {}) {
 const symbols=snapshot?.universe?.symbols ?? [], records=snapshot?.records ?? [];
 const failures=[];
 if (!expectedDate || snapshot?.dataAsOf !== expectedDate) failures.push('unexpected completed session');
 if (snapshot?.mode !== 'complete' || (persisted && snapshot?.status !== 'COMPLETE')) failures.push('snapshot incomplete');
 if (symbols.length !== 30 || records.length !== 30 || new Set(records.map(x=>x.symbol)).size !== 30 || symbols.some(s=>!records.some(r=>r.symbol===s))) failures.push('universe coverage incomplete');
 if (records.some(r=>r.dataStatus!=='FRESH'||r.tradingDate!==expectedDate)) failures.push('stale or mixed-date records');
 const h=snapshot?.health;
 if (!h || h.fresh!==30 || h.cached || h.stale || h.error || h.missing?.length || h.errors?.length) failures.push('unhealthy market inputs');
 const c=snapshot?.eventCalendar;
 if (c?.status!=='VERIFIED' || c.coveredSymbols?.length!==30 || symbols.some(s=>!c.coveredSymbols.includes(s)) || c.errors?.length) failures.push('event calendar unknown');
 if(failures.length) throw new Error(`TailTrend publication blocked: ${failures.join('; ')}`);
 return true;
}
export async function snapshotHashes(directory) {
 let names;try{names=await readdir(directory);}catch(e){if(e.code==='ENOENT')return {};throw e;}
 return Object.fromEntries(await Promise.all(names.filter(n=>n.endsWith('.json')).map(async n=>[n,createHash('sha256').update(await readFile(join(directory,n))).digest('hex')])));
}
export function assertHistoryUnchanged(before, after) {
 for(const [name,hash] of Object.entries(before)) if(after[name]!==hash) throw new Error(`Historical snapshot changed or removed: ${name}`);
 return true;
}


export function validatedCalendarEvents(response, requestedSymbols, {from, through, limit = 100} = {}) {
 if(!Array.isArray(response?.list) || response.has_more===true || response.hasMore===true || response.next_cursor || response.nextCursor || response.next_page_token) throw new Error('calendar response malformed or incomplete');
 const events=[];
 for(const group of response.list) {
  if(!group || !Array.isArray(group.infos)) throw new Error('calendar group missing infos array');
  for(const info of group.infos) {
   if(!info || typeof info!=='object') throw new Error('calendar event malformed');
   const parts=String(info.counter_id ?? '').split('/');
   const symbol=parts.length>=3?`${parts.at(-1)}.${parts.at(-2)}`.toUpperCase():null;
   const raw=info.ext?.local_date ?? info.date ?? group.date;
   const date=String(raw ?? '').match(/^\d{4}[-.]\d{2}[-.]\d{2}/)?.[0]?.replaceAll('.','-');
   if(!symbol || !requestedSymbols.includes(symbol) || !date || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0,10)!==date || (from && date<from) || (through && date>through)) throw new Error('calendar event has invalid symbol or date');
   events.push({symbol,date,timing:info.ext?.financial_report?.market_time ?? info.date_type ?? null,label:info.content ?? '业绩披露'});
  }
 }
 if(events.length>=limit || (Number.isFinite(response.total) && response.total>events.length)) throw new Error('calendar response potentially truncated');
 return events;
}
