#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {prepareResearchPublication} from './research-publication.mjs';
import {expectedSession} from '../scheduler/refresh-runner.mjs';
if(!process.argv.includes('--manual-research')) throw new Error('Explicit --manual-research required; not an automated live publishing path');
const path=fileURLToPath(new URL('../../portal/vendor/incomeos/data/incomeos-full.json',import.meta.url));
const data=prepareResearchPublication(JSON.parse(await readFile(path,'utf8')),expectedSession(),new Date(),{manual:true});
await writeFile(path,JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({mode:data.mode,publicationMode:data.publicationMode,executionAllowed:data.executionAllowed,publicationReady:data.dataQuality.publicationReady,researchPublicationReady:data.dataQuality.researchPublicationReady,assetCount:data.assets.length,optionCount:data.options.length}));
