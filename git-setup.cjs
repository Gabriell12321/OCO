const fs=require('node:fs/promises');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
(async()=>{
 const release=await(await fetch('https://api.github.com/repos/git-for-windows/git/releases/latest')).json();
 const asset=release.assets.find(a=>/^MinGit-.*-64-bit.zip$/.test(a.name)&&!a.name.includes('busybox'));
 const output=path.join(__dirname,'.setup','mingit.zip');
 const response=await fetch(asset.browser_download_url);if(!response.ok)throw Error('Git download failed');
 await fs.writeFile(output,Buffer.from(await response.arrayBuffer()));
 execFileSync('powershell.exe',['-NoProfile','-Command',"Expand-Archive -LiteralPath '.setup/mingit.zip' -DestinationPath '.setup/mingit' -Force"],{cwd:__dirname});
 await fs.copyFile(path.join(__dirname,'.setup/mingit/usr/bin/sh.exe'),path.join(__dirname,'.setup/mingit/usr/bin/bash.exe'));
 console.log('Git e Bash portáteis prontos.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
