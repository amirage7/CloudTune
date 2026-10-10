'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');const CACHE=path.join(ROOT,'.packaging');const RELEASE=path.join(ROOT,'release');
const FILES=['server.js','launcher.js','network-bootstrap.js','data-location.js','discovery.js','ingestion.js','bilibili.js','bilibili-mp3.js','cover-art.js','metadata-recognition.js','mp3-tags.js','music-text.js','netease-like.js','session-store.js','sources.js','package.json','package-lock.json','README.md','启动 CloudTune.bat','使用说明.txt'];
const COMPONENTS=[
  {name:'Node.js',version:'22.23.3',file:'node.zip',checksums:'node-checksums.txt',match:'node-v22.23.3-win-x64.zip',url:'https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip'},
  {name:'yt-dlp',version:'2026.08.19',file:'yt-dlp.exe',checksums:'yt-dlp-checksums.txt',match:'yt-dlp.exe',url:'https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe'},
  {name:'FFmpeg',version:'9.0.2',file:'ffmpeg.zip',checksums:'ffmpeg-checksum.txt',url:'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'}
];
async function sha(file){return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');}
async function build(){
  const records=[];for(const component of COMPONENTS){const sums=await fs.readFile(path.join(CACHE,component.checksums),'utf8');const line=component.match?sums.split(/\r?\n/).find(x=>x.trim().endsWith(' '+component.match)):sums;const expected=line?.match(/[a-f0-9]{64}/i)?.[0]?.toLowerCase();const hash=await sha(path.join(CACHE,component.file));if(hash!==expected)throw new Error(`校验失败：${component.name}`);records.push({...component,sha256:hash});}
  const stage=path.join(RELEASE,'CloudTune-0.7.4-Windows-x64');
  if(path.dirname(stage)!==RELEASE || !RELEASE.startsWith(ROOT+path.sep))throw new Error('发布路径不安全');
  await fs.mkdir(RELEASE,{recursive:true});await fs.rm(stage,{recursive:true,force:true});await fs.mkdir(stage);
  for(const file of FILES)await fs.copyFile(path.join(ROOT,file),path.join(stage,file));
  await fs.cp(path.join(ROOT,'public'),path.join(stage,'public'),{recursive:true});
  // Install from the lockfile into a fresh folder, never copy the developer's dependencies or caches.
  const npm=spawnSync(process.env.ComSpec || 'cmd.exe',['/d','/c','npm ci --omit=dev --ignore-scripts --no-audit --no-fund'],{cwd:stage,stdio:'inherit',windowsHide:true});if(npm.status!==0)throw new Error('安装分发依赖失败');
  await fs.mkdir(path.join(stage,'runtime'));await fs.copyFile(path.join(CACHE,'node','node-v22.23.3-win-x64','node.exe'),path.join(stage,'runtime','node.exe'));
  await fs.mkdir(path.join(stage,'tools'));await fs.copyFile(path.join(CACHE,'yt-dlp.exe'),path.join(stage,'tools','yt-dlp.exe'));
  const ff=path.join(CACHE,'ffmpeg','ffmpeg-9.0.2-essentials_build');
  for(const exe of ['ffmpeg.exe','ffprobe.exe'])await fs.copyFile(path.join(ff,'bin',exe),path.join(stage,'tools',exe));
  const notices=path.join(stage,'third-party');await fs.mkdir(notices);
  await fs.copyFile(path.join(CACHE,'node','node-v22.23.3-win-x64','LICENSE'),path.join(notices,'Node-LICENSE.txt'));
  for(const file of ['yt-dlp-LICENSE.txt','yt-dlp-THIRD_PARTY_LICENSES.txt'])await fs.copyFile(path.join(CACHE,file),path.join(notices,file));
  for(const file of ['LICENSE','README.txt'])await fs.copyFile(path.join(ff,file),path.join(notices,'FFmpeg-'+file+'.txt'));
  await fs.writeFile(path.join(notices,'provenance.json'),JSON.stringify(records,null,2));
  await fs.writeFile(path.join(notices,'说明.txt'),'运行环境和工具原样分发，许可文本在本目录。npm 依赖保留各自包内的许可证。\nNode 源码：https://nodejs.org/dist/v22.23.3/\nyt-dlp 源码：https://github.com/yt-dlp/yt-dlp/tree/2026.08.19\nFFmpeg 构建与来源：https://www.gyan.dev/ffmpeg/builds/\nFFmpeg 对应源码：https://github.com/FFmpeg/FFmpeg/commit/946fcce07b\nFFmpeg 构建配置及外部库版本：FFmpeg-README.txt.txt\n本应用 JavaScript 源文件随包提供。\n');
  // BAT uses UTF-8 + CRLF for Windows cmd.exe.
  for(const file of FILES.filter(x=>x.endsWith('.bat'))){const text=await fs.readFile(path.join(stage,file),'utf8');await fs.writeFile(path.join(stage,file),text.replace(/\r?\n/g,'\r\n'));}
  for(const name of ['data','tests','.packaging','.env','runtime.json','launch.lock','tasks.json','session.json']){try{await fs.access(path.join(stage,name));throw new Error(`发布包包含禁止文件：${name}`);}catch(e){if(e.code!=='ENOENT')throw e;}}
  console.log(`发布目录准备完成：${stage}`);
  const zip=path.join(RELEASE,'CloudTune-0.7.4-Windows-x64.zip');
  await fs.rm(zip,{force:true});
  // Pass paths as JSON to a dedicated script, not interpolated shell code.
  await fs.writeFile(path.join(CACHE,'zip-input.json'),JSON.stringify({source:stage,output:zip}));
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'zip-portable.ps1'),'-Config',path.join(CACHE,'zip-input.json')],{stdio:'inherit',windowsHide:true});if(result.status!==0)throw new Error('压缩发布包失败');
  const hash=await sha(zip);await fs.writeFile(zip+'.sha256',hash+'  '+path.basename(zip)+'\n');console.log(JSON.stringify({zip,bytes:(await fs.stat(zip)).size,sha256:hash}));
  return {stage,zip,hash};
}
if(require.main===module)build().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={FILES,build};


