const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = __dirname;
async function get(url, output) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} downloading ${url}`);
  await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
}
(async () => {
  await fs.mkdir(path.join(root, '.setup'), { recursive: true });
  const meta = await (await fetch('https://registry.npmjs.org/three/0.180.0')).json();
  await get(meta.dist.tarball, path.join(root,'.setup','three.tgz'));
  execFileSync('tar.exe',['-xf',path.join(root,'.setup','three.tgz'),'-C',path.join(root,'.setup')]);
  await fs.cp(path.join(root,'.setup/package/build/three.module.js'),path.join(root,'dist/vendor/three.module.js'));
  await fs.cp(path.join(root,'.setup/package/build/three.core.js'),path.join(root,'dist/vendor/three.core.js'));
  await fs.cp(path.join(root,'.setup/package/examples/jsm'),path.join(root,'dist/vendor/addons'),{recursive:true});
  await fs.cp(path.join(root,'.setup/package/LICENSE'),path.join(root,'dist/vendor/THREE-LICENSE.txt'));
  console.log('Three.js '+meta.version+' preparado localmente.');
})().catch(err=>{ console.error(err.message); process.exitCode=1; });
