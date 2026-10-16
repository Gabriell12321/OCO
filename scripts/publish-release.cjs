'use strict';

// Publishes the already tested portable ZIP to this project's GitHub release.
// Authentication stays in Windows DPAPI, outside this repository.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { readLocalToken } = require('./github-credential.cjs');
const repoRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.dirname(repoRoot);
const repository = 'Gabriell12321/OCO';
const version = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const tag = 'v' + version;
const zipFile = path.join(workspaceRoot, 'Quarto 01 Windows.zip');
const notesFile = process.argv[2];

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function run() {
  if (!notesFile || !fs.statSync(zipFile).isFile()) throw new Error('Informe as notas da versao e gere o ZIP antes de publicar.');
  const git = fs.existsSync(path.join(repoRoot, '.setup', 'mingit', 'cmd', 'git.exe'))
    ? path.join(repoRoot, '.setup', 'mingit', 'cmd', 'git.exe') : 'git';
  const head = spawnSync(git, ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  const status = spawnSync(git, ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  if (head.status !== 0 || status.status !== 0 || status.stdout.trim()) throw new Error('Faca commit das fontes finais antes da publicacao.');
  const sha = head.stdout.trim();
  const headers = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + readLocalToken(),
    'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'OCO-release-publisher' };
  async function api(endpoint, options = {}, acceptMissing = false) {
    const response = await fetch('https://api.github.com/repos/' + repository + endpoint,
      { ...options, headers: { ...headers, ...options.headers } });
    if (acceptMissing && response.status === 404) return null;
    const body = await response.json();
    if (!response.ok) throw new Error('GitHub respondeu ' + response.status + ' em ' + endpoint);
    return body;
  }
  const remote = await api('/git/ref/heads/main');
  if (remote.object?.sha !== sha) throw new Error('O main remoto ainda nao corresponde ao commit local. Faca push antes.');
  const tagRef = await api('/git/ref/tags/' + tag, {}, true);
  if (tagRef) {
    let object = tagRef.object;
    for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) {
      object = (await api('/git/tags/' + object.sha)).object;
    }
    if (object?.type !== 'commit' || object.sha !== sha) {
      throw new Error('A tag existente aponta para outro commit. Use uma nova versao.');
    }
  }
  let release = await api('/releases/tags/' + tag, {}, true);
  if (!release) release = (await api('/releases?per_page=100')).find(item => item.tag_name === tag) || null;
  const body = fs.readFileSync(path.resolve(notesFile), 'utf8');
  if (release && !release.draft) throw new Error('Esta versao ja foi publicada. Use uma nova versao.');
  if (release && !tagRef && release.target_commitish !== sha) {
    throw new Error('O rascunho existente pertence a outro commit. Use uma nova versao.');
  }
  if (!release) release = await api('/releases', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: tag, target_commitish: sha, name: 'Quarto 01 — ' + tag,
      body, draft: true, prerelease: false }) });
  const uploadURL = new URL(release.upload_url.replace(/\{.*$/, ''));
  if (uploadURL.origin !== 'https://uploads.github.com' || !uploadURL.pathname.startsWith('/repos/' + repository + '/releases/')) {
    throw new Error('Destino de upload inesperado.');
  }
  const archiveName = 'Quarto-01-Windows-' + tag + '.zip';
  const checksum = await digest(zipFile);
  const assets = [
    { name: archiveName, type: 'application/zip', size: fs.statSync(zipFile).size, file: zipFile },
    { name: 'SHA256SUMS.txt', type: 'text/plain', content: Buffer.from(checksum + '  ' + archiveName + '\n') },
  ];
  const existing = await api('/releases/' + release.id + '/assets');
  for (const asset of assets) {
    const previous = existing.find(item => item.name === asset.name);
    if (previous) {
      if (previous.digest === 'sha256:' + (asset.file ? checksum : crypto.createHash('sha256').update(asset.content).digest('hex'))) continue;
      throw new Error('Ja existe um asset diferente com este nome no rascunho.');
    }
    const url = new URL(uploadURL); url.searchParams.set('name', asset.name);
    console.log('Enviando ' + asset.name + '...');
    const response = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': asset.type,
      'Content-Length': String(asset.size || asset.content.length) },
      body: asset.file ? fs.createReadStream(asset.file) : asset.content, ...(asset.file ? { duplex: 'half' } : {}) });
    const result = await response.json();
    if (!response.ok || result.size !== (asset.size || asset.content.length)) throw new Error('Falha no upload de ' + asset.name + ' (HTTP ' + response.status + ').');
    if (asset.file && result.digest && result.digest !== 'sha256:' + checksum) throw new Error('O checksum do upload difere do arquivo local.');
    console.log('Upload verificado: ' + asset.name);
  }
  const published = await api('/releases/' + release.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draft: false, body, make_latest: 'true' }) });
  console.log(JSON.stringify({ release: published.html_url, tag, commit: sha, sha256: checksum,
    assets: published.assets.map(asset => ({ name: asset.name, size: asset.size, url: asset.browser_download_url, digest: asset.digest })) }));
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
