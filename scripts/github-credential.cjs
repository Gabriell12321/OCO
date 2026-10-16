'use strict';

// Repository-scoped Git credential helper. Only Git should invoke its CLI:
// stdout is Git's private credential channel, never a diagnostic log.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readLocalToken() {
  if (process.platform !== 'win32') throw new Error('A credencial local usa Windows DPAPI.');
  const credentialFile = process.env.OCO_GITHUB_CREDENTIAL_PATH ||
    path.resolve(__dirname, '..', '..', '.private', 'GITHUB.md');
  const literal = credentialFile.replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop'; $line = [IO.File]::ReadAllText('${literal}'); ` +
    `$match = [regex]::Match($line, '(?m)^Token-DPAPI: ([0-9a-fA-F]+)\\s*$'); ` +
    `if (!$match.Success) { throw 'Credencial ausente'; }; ` +
    `$secure = ConvertTo-SecureString $match.Groups[1].Value; ` +
    `$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); ` +
    `try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) } ` +
    `finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose(); }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 65536 });
  if (result.error || result.status !== 0) throw new Error('Nao foi possivel abrir a credencial local.');
  const token = result.stdout.trim();
  if (!/^[A-Za-z0-9_]{20,}$/.test(token)) throw new Error('Credencial local invalida.');
  return token;
}

module.exports = { readLocalToken };

if (require.main === module && process.argv[2] === 'get') {
  try {
    const fields = Object.fromEntries(fs.readFileSync(0, 'utf8').split(/\r?\n/)
      .filter(line => line.includes('='))
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
    if (fields.protocol === 'https' && fields.host === 'github.com' &&
        /^Gabriell12321\/OCO(?:\.git)?$/i.test(fields.path || '')) {
      process.stdout.write('username=Gabriell12321\npassword=' + readLocalToken() + '\n\n');
    }
  } catch {
    process.stderr.write('A credencial local do repositorio OCO nao esta disponivel.\n');
    process.exitCode = 1;
  }
}
