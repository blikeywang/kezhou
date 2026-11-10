import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
export function requestErrorCode(error) {
 const text=String(error?.stderr??'')+' '+String(error?.message??'');
 if(error?.code==='ENOENT') return 'CLIENT_UNAVAILABLE';
 if(/401|403|unauthorized|forbidden/i.test(text)) return 'AUTHORIZATION_FAILED';
 if(/429|rate.?limit|too many requests/i.test(text)) return 'RATE_LIMITED';
 if(error?.killed || /timeout|timed out|ETIMEDOUT/i.test(text)) return 'REQUEST_TIMEOUT';
 if(error instanceof SyntaxError) return 'INVALID_RESPONSE';
 return 'SOURCE_REQUEST_FAILED';
}
export function createLongbridgeClient({run=execute,sleep=wait,random=Math.random,now=()=>new Date(),concurrency=3}={}) {
 const requests=[];let active=0;const queue=[];
 async function acquire(){if(active>=concurrency) await new Promise(resolve=>queue.push(resolve));else active++;}
 function release(){const next=queue.shift();if(next)next();else active--;}
 async function request(args,timeout=75000) {
  await acquire();
  const record={endpoint:args.slice(0,args[0]==='option'?2:1).join(' '),symbols:args.filter(x=>/^[A-Z0-9.]+\.US$/.test(x)),startedAt:now().toISOString(),finishedAt:null,attempts:0,status:'running',code:null};
  requests.push(record);
  try {
   for(let attempt=1;attempt<=3;attempt++) {
    record.attempts=attempt;
    try {const {stdout}=await run('longbridge',[...args,'--format','json'],{cwd:'/tmp',timeout,maxBuffer:64*1024*1024});const result=stdout.trim()?JSON.parse(stdout):null;record.status='succeeded';record.code=null;return result;}
    catch(error){record.code=requestErrorCode(error);if(attempt===3||['AUTHORIZATION_FAILED','CLIENT_UNAVAILABLE','INVALID_RESPONSE'].includes(record.code)){record.status='failed';const safe=new Error(`${record.code}: source request failed`);safe.code=record.code;throw safe;}await sleep(2000*2**(attempt-1)+Math.floor(random()*500));}
   }
  } finally {record.finishedAt=now().toISOString();release();}
 }
 return {request,requests};
}
export function attachRetrieval(data,phase,startedAt,requests,finishedAt=new Date().toISOString()) {
 const start=process.env.INCOMEOS_RETRIEVAL_STARTED_AT||data.retrievalStartedAt||startedAt;
 data.retrievalStartedAt=start;data.retrievalFinishedAt=finishedAt;data.retrievedAt=finishedAt;
 data.retrieval={...(data.retrieval??{}),startedAt:start,finishedAt,meaning:'client retrieval window; not source publication time',phases:{...(data.retrieval?.phases??{}),[phase]:{startedAt,finishedAt,requests}}};
 return data;
}
