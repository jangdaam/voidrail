import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const sources={};
async function walk(dir) {
  for(const ent of await fs.readdir(path.join(root,dir),{withFileTypes:true})) {
    const rel=path.posix.join(dir,ent.name);
    if(ent.isDirectory()) await walk(rel);
    else if(ent.name.endsWith('.js')) {
      let code=await fs.readFile(path.join(root,rel),'utf8');
      code=code.replace(/(from\s*|import\s*\(\s*)(['"])([^'"]+)\2/g,(all,prefix,quote,spec)=>{
        let target;
        if(spec==='three') target='vendor/three.module.js';
        else if(spec.startsWith('three/addons/')) target='vendor/addons/'+spec.slice(13);
        else if(spec.startsWith('.')) target=path.posix.normalize(path.posix.join(path.posix.dirname(rel),spec));
        else return all;
        return prefix+quote+'vr/'+target+quote;
      });
      sources['vr/'+rel]=code;
    }
  }
}
await walk('js'); await walk('vendor');
let html=await fs.readFile(path.join(root,'index.html'),'utf8');
html=html.replace(/<script type="importmap">[\s\S]*?<\/script>/,'');
const boot='const sources='+JSON.stringify(sources).replace(/</g,'\\u003c')+';const map=document.createElement("script");map.type="importmap";map.text=JSON.stringify({imports:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,URL.createObjectURL(new Blob([v],{type:"text/javascript"}))]))});document.head.append(map);import("vr/js/main.js").catch(e=>{document.querySelector("#err").style.display="flex";document.querySelector("#err").textContent=e.stack;});';
html=html.replace('<script type="module" src="js/main.js"></script>',()=>'<script>'+boot+'</script>');
await fs.writeFile(path.join(root,'industrial-preview.html'),html);
console.log('Offline preview rebuilt: '+Object.keys(sources).length+' modules');
