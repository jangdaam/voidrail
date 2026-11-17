import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const files=[];
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(/\.(js|mjs)$/.test(e.name))files.push(p);}}
walk('js');walk('scripts');
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'pipe'});if(r.status!==0){process.stderr.write(r.stderr);process.exit(1);}}
console.log('Syntax OK: '+files.length+' files');
for(const test of ['check-design.mjs','check-director.mjs','check-courses.mjs','check-transport.mjs','check-origin.mjs']){
 const r=spawnSync(process.execPath,['--no-warnings','--experimental-loader','./scripts/three-loader.mjs','scripts/'+test],{stdio:'inherit'});
 if(r.status!==0)process.exit(r.status||1);
}
