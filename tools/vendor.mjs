// vendor/ 폴더 재생성: three.js 와 Trystero 를 저장소에 포함시켜 CDN 없이 동작하게 한다.
//   npm install && npm run vendor
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';

mkdirSync('vendor/addons/utils', { recursive: true });
copyFileSync('node_modules/three/build/three.module.js', 'vendor/three.module.js');
copyFileSync('node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'vendor/addons/utils/BufferGeometryUtils.js');

writeFileSync('tools/.trystero-entry.mjs', `export { joinRoom as joinNostr } from 'trystero';\nexport { joinRoom as joinWs } from '@trystero-p2p/ws-relay';\n`);
await build({ entryPoints: ['tools/.trystero-entry.mjs'], bundle: true, format: 'esm', minify: true, target: 'es2020', outfile: 'vendor/trystero.js' });
rmSync('tools/.trystero-entry.mjs');
console.log('vendor/ 갱신 완료');
