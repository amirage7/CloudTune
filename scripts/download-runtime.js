'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const dir=path.join(__dirname,'..','.packaging');
function powershell(script,args){return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,script),...args],{stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${script}: ${code}`)));});}
async function download(url,file){const dest=path.join(dir,file);await powershell('download-file.ps1',['-Url',url,'-Output',dest]);return fs.readFile(dest);}
async function main(){
  await fs.mkdir(dir,{recursive:true});
  const records=await Promise.all([
    ['Node.js','22.23.3','https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip','node.zip','https://nodejs.org/dist/v22.23.3/SHASUMS256.txt','node-v22.23.3-win-x64.zip'],
    ['yt-dlp','2026.08.19','https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe','yt-dlp.exe','https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/SHA2-256SUMS','yt-dlp.exe'],
    ['FFmpeg','release-essentials','https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip','ffmpeg.zip','https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256',null]
  ].map(async([name,version,url,file,sumUrl,sumName])=>{
    const checksumFile=file==='node.zip'?'node-checksums.txt':file==='yt-dlp.exe'?'yt-dlp-checksums.txt':'ffmpeg-checksum.txt';
    const sums=(await download(sumUrl,checksumFile)).toString('utf8');const line=sumName?sums.split(/\r?\n/).find(x=>x.trim().endsWith(' '+sumName)):sums;
    const expected=line?.match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase();if(!expected)throw new Error(`Missing checksum: ${name}`);
    let bytes;try{bytes=await fs.readFile(path.join(dir,file));}catch{}
    if(!bytes || crypto.createHash('sha256').update(bytes).digest('hex')!==expected)bytes=await download(url,file);
    const sha256=crypto.createHash('sha256').update(bytes).digest('hex');if(sha256!==expected)throw new Error(`Checksum mismatch: ${name}`);
    console.log(`${name}: verified ${bytes.length} bytes`);return {name,version,url,checksumUrl:sumUrl,sha256};
  }));
  await download('https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.08.19/LICENSE','yt-dlp-LICENSE.txt');
  await download('https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.08.19/THIRD_PARTY_LICENSES.txt','yt-dlp-THIRD_PARTY_LICENSES.txt');
  await fs.writeFile(path.join(dir,'provenance.json'),JSON.stringify(records,null,2));
  await powershell('extract-runtime.ps1',['-Cache',dir]);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
