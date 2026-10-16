'use strict';

// Dependency-free portable builder. Windows execution policies are left intact:
// PowerShell is used only for its normal inline archive cmdlets, never a .ps1.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const VERSION = '44.7.2';
const SHA256 = '10a89447ef64ac5cb9f782af48ffd83734a40ae91681259d1048ca3c9e6c5da4';
const desktopRoot = fs.realpathSync(__dirname);
const projectRoot = path.dirname(desktopRoot);
const workspaceRoot = path.dirname(projectRoot);
const appRoot = path.join(workspaceRoot, 'Windows', 'Quarto 01');
const resourcesRoot = path.join(appRoot, 'resources', 'app');
const runtimeRoot = path.join(desktopRoot, '.cache');
const runtimeZip = path.join(runtimeRoot, `electron-v${VERSION}-win32-x64.zip`);
const zipOutput = path.join(workspaceRoot, 'Quarto 01 Windows.zip');
const refreshOnly = process.argv.includes('--refresh');
const skipZip = process.argv.includes('--skip-zip');
const appVersion = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')).version;

function ensureWorkspaceTarget(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(workspaceRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Destino fora do projeto: ${resolved}`);
  return resolved;
}
function removeBuildOutput(target) {
  fs.rmSync(ensureWorkspaceTarget(target), { recursive: true, force: true });
}
const literal = value => "'" + value.replaceAll("'", "''") + "'";
function powershell(script) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; " + script], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Falha ao preparar arquivos do Windows (${result.status}).`);
}

async function build() {
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.mkdirSync(resourcesRoot, { recursive: true });
  if (!refreshOnly) {
    if (!fs.existsSync(runtimeZip)) {
      const url = `https://github.com/electron/electron/releases/download/v${VERSION}/electron-v${VERSION}-win32-x64.zip`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download oficial falhou: ${response.status}`);
      fs.writeFileSync(runtimeZip, Buffer.from(await response.arrayBuffer()));
    }
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(runtimeZip)).digest('hex');
    if (actualHash !== SHA256) throw new Error('SHA256 do Electron não confere com SHASUMS256.txt oficial.');
    if (!fs.existsSync(path.join(appRoot, 'Quarto 01.exe'))) {
      powershell(`Expand-Archive -LiteralPath ${literal(runtimeZip)} -DestinationPath ${literal(appRoot)} -Force`);
      fs.renameSync(path.join(appRoot, 'electron.exe'), path.join(appRoot, 'Quarto 01.exe'));
    }
  }
  if (!fs.existsSync(path.join(appRoot, 'Quarto 01.exe'))) throw new Error('Runtime ausente. Execute o builder sem --refresh.');
  const contentRoot = path.join(resourcesRoot, 'dist');
  removeBuildOutput(contentRoot);
  fs.cpSync(path.join(projectRoot, 'dist'), contentRoot, { recursive: true });
  const rendererSource = fs.readFileSync(path.join(contentRoot, 'main.js'), 'utf8');
  const firstPersonOnly = /firstPersonOnly\s*:\s*true/.test(rendererSource);
  if (firstPersonOnly) {
    if (/\bfrom\s*['"]\.\/avatar\.js['"]/.test(rendererSource)) {
      throw new Error('O modo de primeira pessoa ainda importa o avatar removido.');
    }
    // Keep the development originals, but do not ship the removed character or
    // the obsolete cinematic renderer in the first-person application.
    for (const obsolete of ['avatar.js', 'assets/character', 'cinematic.js']) {
      removeBuildOutput(path.join(contentRoot, obsolete));
    }
  }
  for (const name of ['package.json', 'main.cjs', 'preload.cjs', 'benchmark-renderer.cjs']) fs.copyFileSync(path.join(desktopRoot, name), path.join(resourcesRoot, name));
  fs.copyFileSync(path.join(desktopRoot, 'LEIA-ME.txt'), path.join(appRoot, 'LEIA-ME.txt'));
  removeBuildOutput(path.join(appRoot, 'resources', 'default_app.asar'));
  const credits = path.join(appRoot, 'CREDITOS');
  fs.mkdirSync(credits, { recursive: true });
  if (firstPersonOnly) removeBuildOutput(path.join(credits, 'CHARACTER.md'));
  for (const name of firstPersonOnly ? ['ASSETS.md', 'SHADOW-ASSET.md'] : ['ASSETS.md', 'CHARACTER.md', 'SHADOW-ASSET.md']) {
    if (fs.existsSync(path.join(projectRoot, name))) fs.copyFileSync(path.join(projectRoot, name), path.join(credits, name));
  }
  const documentation = path.join(appRoot, 'DOCUMENTACAO');
  removeBuildOutput(documentation);
  fs.mkdirSync(documentation, { recursive: true });
  for (const name of ['ENGINE.md', 'VALIDACAO.md', `ATUALIZACAO-${appVersion}.md`]) {
    if (fs.existsSync(path.join(projectRoot, name))) {
      fs.copyFileSync(path.join(projectRoot, name), path.join(documentation, name));
    }
  }
  fs.writeFileSync(path.join(appRoot, 'build-info.json'), JSON.stringify({
    product: 'Quarto 01', version: appVersion, platform: 'win32-x64', electronVersion: VERSION,
    electronSHA256: SHA256, source: `https://github.com/electron/electron/releases/tag/v${VERSION}`,
    firstPersonOnly, builtAt: new Date().toISOString(),
  }, null, 2));
  if (!skipZip) {
    removeBuildOutput(zipOutput);
    powershell(`Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory(${literal(appRoot)}, ${literal(zipOutput)}, [IO.Compression.CompressionLevel]::Optimal, $true)`);
    console.log('ZIP: ' + zipOutput);
  }
  console.log('EXE: ' + path.join(appRoot, 'Quarto 01.exe'));
}
build().catch(error => { console.error(error); process.exitCode = 1; });
