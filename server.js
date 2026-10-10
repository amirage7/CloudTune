'use strict';
const http=require('node:http');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Readable,Transform}=require('node:stream');
const {MAX_AUDIO_SIZE,AUDIO_EXT,isApprovedSource,searchAll,searchMetadataCandidates,cleanText}=require('./sources');
const {manager:createBiliManager}=require('./bilibili-mp3');
const {writeTags,cleanField,extractCover}=require('./mp3-tags');
const {detectImage,MAX_COVER_SIZE,fetchArtwork,findExactCandidate}=require('./cover-art');
const {lookupCloudSongId,ensureLiked,numberId}=require('./netease-like');
const {createSessionStore}=require('./session-store');
const {searchMusicMetadata,videoEvidence,recognizeMetadata}=require('./metadata-recognition');
const {rankSources}=require('./discovery');
const {createIngestion}=require('./ingestion');
const {normalizeBiliUrl,locateExecutable,inspectSource}=require('./bilibili-mp3');
const {spawn}=require('node:child_process');
function metadataSearch(query){let sdk;try{sdk=getSdk();}catch{}return searchMusicMetadata(query,sdk);}

const ROOT=__dirname;
const DATA=process.env.CLOUDTUNE_DATA || path.join(ROOT,'data');
const TRACKS=path.join(DATA,'tracks');
const COVERS=path.join(DATA,'covers');
const DB=path.join(DATA,'library.json');
const SETTINGS=path.join(DATA,'settings.json');
const sessionStore=createSessionStore(DATA);
const PUBLIC=path.join(ROOT,'public');
const HOST='127.0.0.1'; // Do not expose the authenticated app to the LAN.
const PORT=Number(process.env.PORT || 4173);
const tracks=new Map();
const searchIndex=new Map();
let settings={jamendoClientId:'',autoLike:true};
let login={cookie:'',key:'',name:'',userId:''};
const biliDownloads=createBiliManager({tracksDir:TRACKS,addFile,uploadToCloud:handleUpload});
const ingestion=createIngestion(DATA,{
  account:()=>({connected:!!login.cookie,id:login.userId||login.name}),
  acquire:async(source,meta,progress,onCancel)=>{
    const existing=Array.from(tracks.values()).find(x=>x.pageUrl&&x.pageUrl===source.pageUrl&&x.title===meta.title&&x.artist===meta.artist);
    if(existing&&await fsp.access(path.join(TRACKS,existing.id+'.'+existing.format.toLowerCase())).then(()=>true,()=>false)){await progress('已找到同来源的本地文件，跳过重复获取');return existing;}
    if(source.kind==='bilibili'){
      const inspection=new AbortController();onCancel(()=>inspection.abort());
      await progress('检查音源能否下载，最长45秒；通过后自动下载');await inspectSource(source.pageUrl,{signal:inspection.signal,onProgress:progress});if(inspection.signal.aborted)throw new Error('音源检查已取消');await progress('技术检查通过，开始获取已确认有权使用的音源');
      const result=await biliDownloads.start({url:source.pageUrl,...meta,syncToCloud:false});
      onCancel(()=>biliDownloads.cancel(result.id));let previous='';
      for(let i=0;i<850;i++){await new Promise(r=>setTimeout(r,900));const job=biliDownloads.get(result.id);if(job.message!==previous){previous=job.message;await progress(previous);}if(job.stage==='done')return job.entry;if(['error','cancelled'].includes(job.stage))throw new Error(job.error||job.message);}
      throw new Error('音源处理超时，请检查任务或本地音乐库');
    }
    if(!source.downloadable||!isApprovedSource(source.url))throw new Error('该来源不能直接获取文件');
    searchIndex.set(source.id,{...source,cachedAt:Date.now()});return (await handleDownload(source.id)).entry;
  },
  prepare:async(id,meta)=>{await ensureMp3(id);const entry=tracks.get(id);if(entry.cloudStatus==='uploaded'&&entry.cloudAccountId===login.userId&&entry.coverExt)return entry;try{return (await updateMetadata(id,{...meta,artworkUrl:entry.coverExt?'':meta.artworkUrl})).entry;}catch(e){if(!meta.artworkUrl)throw e;entry.coverError='所选封面未获取，待完善：'+e.message;return (await updateMetadata(id,{...meta,artworkUrl:''})).entry;}},
  upload:async id=>(await handleUpload(id)).entry
});
const CONTENT_TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
let sdkCache;

function getSdk(){
  if(sdkCache) return sdkCache;
  try{sdkCache=require('@neteasecloudmusicapienhanced/api');return sdkCache;}
  catch(_){const e=new Error('网易云接口模块尚未安装。请运行 npm install 后重试。');e.status=503;throw e;}
}
async function init(){
  await ingestion.init();
  await fsp.mkdir(TRACKS,{recursive:true});
  await fsp.mkdir(COVERS,{recursive:true});
  try{settings=Object.assign(settings,JSON.parse(await fsp.readFile(SETTINGS,'utf8')));}catch{}
  try{(JSON.parse(await fsp.readFile(DB,'utf8')) || []).forEach(x=>tracks.set(x.id,x));}catch{}
  login=await sessionStore.load() || {cookie:'',key:'',name:'',userId:''};
  if(login.cookie){
    let timer;
    try{
      const remote=await Promise.race([getSdk().user_account({cookie:login.cookie}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),8000);})]);
      const profile=remote?.body?.profile;
      if(profile?.userId){login.name=profile.nickname || login.name;login.userId=numberId(profile.userId);}
      else if([200,301,401,403].includes(Number(remote?.body?.code))){await sessionStore.clear();login={cookie:'',key:'',name:'',userId:''};}
    }catch(e){
      // A transient network/SDK failure must not erase a saved credential.
      if([301,401,403].includes(Number(e?.body?.code || e?.status))){await sessionStore.clear();login={cookie:'',key:'',name:'',userId:''};}
    }finally{clearTimeout(timer);}
  }
}
function json(res,code,data){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function error(res,err){const msg=err?.message || '操作失败'; console.error('[CloudTune]',msg);json(res,err.status && Number.isInteger(err.status)?err.status:500,{error:msg});}
function methodNotAllowed(res){json(res,405,{error:'不支持的请求方法'});}
async function readJson(req,max=20000){let size=0, chunks=[];for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(new Error('请求过大'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');}catch{throw Object.assign(new Error('请求格式有误'),{status:400});}}
function safeName(v){let filename=String(v||'').replace(/[<>:"/\\|?*\x00-\x1F]/g,'_').trim().replace(/[. ]+$/,'');return filename.slice(0,140) || 'audio.mp3';}
function fileFormat(name){const match=String(name).match(AUDIO_EXT);return match?.[1]?.toLowerCase() || '';}
const cloudFields=['cloudStatus','uploadVerified','cloudSongId','uploadResponseIds','likedStatus','likeMethod','likedAt','likeError','cloudCoverPending','uploadFileName','uploadedAt','uploadVerifyError'];
function rememberCloud(entry){if(entry.cloudAccountId&&entry.cloudStatus==='uploaded'){entry.cloudAccounts||={};entry.cloudAccounts[entry.cloudAccountId]=Object.fromEntries(cloudFields.map(key=>[key,entry[key]]));}}
let libraryWrite=Promise.resolve();
async function saveLibrary(){for(const entry of tracks.values())rememberCloud(entry);const snapshot=JSON.stringify(Array.from(tracks.values()),null,2);const next=libraryWrite.then(async()=>{const temp=DB+'.tmp';await fsp.writeFile(temp,snapshot,'utf8');await fsp.rename(temp,DB);});libraryWrite=next.catch(()=>{});return next;}
async function saveSettings(){await fsp.writeFile(SETTINGS,JSON.stringify(settings,null,2),'utf8');}
async function hashFile(filename){const hash=crypto.createHash('sha256');const stream=fs.createReadStream(filename);for await(const data of stream)hash.update(data);return hash.digest('hex');}
async function isAudioFile(filename,filepath){
  const b=Buffer.alloc(64);const handle=await fsp.open(filepath,'r');let n=0;
  try{({bytesRead:n}=await handle.read(b,0,b.length,0));}finally{await handle.close();}
  if(n<4)return false;
  const ext=fileFormat(filename), txt=b.toString('ascii');
  if(ext==='mp3')return txt.startsWith('ID3') || (b[0]===0xff && (b[1]&0xe0)===0xe0);
  if(ext==='flac')return txt.startsWith('fLaC');
  if(ext==='wav')return txt.startsWith('RIFF') && txt.slice(8,12)==='WAVE';
  if(ext==='ogg'||ext==='oga')return txt.startsWith('OggS');
  if(ext==='m4a')return txt.slice(4,8)==='ftyp';
  if(ext==='aac')return b[0]===0xff && (b[1]&0xf0)===0xf0;
  return false;
}
async function saveCoverForEntry(entry, bytes){
  const format=detectImage(bytes);
  if(bytes.length>MAX_COVER_SIZE)throw Object.assign(new Error('封面不能超过 2MB'),{status:413});
  if(entry.format==='MP3'){
    const filename=path.join(TRACKS,entry.id+'.mp3');
    const updated=await writeTags(filename,entry,bytes);
    entry.size=updated.size;entry.sha256=updated.sha256;
  }
  const filename=path.join(COVERS,entry.id+'.'+format.ext);
  const temporary=filename+'.part';
  await fsp.writeFile(temporary,bytes);await fsp.rename(temporary,filename);
  if(entry.coverExt && entry.coverExt!==format.ext)await fsp.unlink(path.join(COVERS,entry.id+'.'+entry.coverExt)).catch(()=>{});
  entry.coverExt=format.ext;entry.coverUpdatedAt=Date.now();
  entry.coverError='';
  if(entry.cloudStatus==='uploaded')entry.metadataNeedsResync=true;
  await saveLibrary();return entry;
}
async function findAndAttachCover(entry){
  if(!entry.title || !entry.artist || entry.coverExt)return;
  try{
    let rows=await metadataSearch(entry.title);
    let exact=findExactCandidate(rows,entry.title,entry.artist);
    if(!exact){rows=await metadataSearch(entry.title+' '+entry.artist);exact=findExactCandidate(rows,entry.title,entry.artist);}
    if(exact){const result=await fetchArtwork(exact.artworkUrl);entry.album=entry.album||exact.album;entry.coverError='';await saveCoverForEntry(entry,result.bytes);}
    else {entry.coverError='未找到同名且歌手匹配的专辑封面，请点击信息 / 封面选择候选或上传图片。';await saveLibrary();}
  }catch(e){entry.coverError='封面获取失败，请在信息 / 封面中重试：'+String(e.message||e);await saveLibrary();}
}
async function addFile(temp, filename, meta={}){
  const size=(await fsp.stat(temp)).size;
  if(size===0 || size>MAX_AUDIO_SIZE)throw Object.assign(new Error('音频文件大小超限（最高100 MB）'),{status:413});
  if(!await isAudioFile(filename,temp))throw Object.assign(new Error('文件内容不是有效的音频格式，已拒绝保存'),{status:400});
  const hash=await hashFile(temp);
  const duplicate=Array.from(tracks.values()).find(x=>x.sha256===hash);
  if(duplicate){await fsp.unlink(temp).catch(()=>{});return {entry:duplicate,duplicate:true};}
  const id=crypto.randomUUID();
  const dest=path.join(TRACKS,id+'.'+fileFormat(filename));
  await fsp.rename(temp,dest);
  const entry={id,name:safeName(filename),title:cleanText(meta.title || path.parse(filename).name),artist:cleanText(meta.artist || ''),album:cleanText(meta.album||''),source:meta.source || '本地导入',license:meta.license || '',pageUrl:meta.pageUrl || '',size,format:fileFormat(filename).toUpperCase(),sha256:hash,downloadedAt:new Date().toISOString(),cloudStatus:'not_uploaded',likedStatus:'not_liked',cloudSongId:''};
  if(entry.format==='MP3' && meta.title && meta.artist){const updated=await writeTags(dest,entry);entry.size=updated.size;entry.sha256=updated.sha256;}
  tracks.set(id,entry);await saveLibrary();
  if(meta.artworkUrl){try{const cover=await fetchArtwork(meta.artworkUrl);await saveCoverForEntry(entry,cover.bytes);}catch(e){entry.coverError='所选封面获取失败：'+e.message;await saveLibrary();}}
  else if(meta.source?.startsWith('B站'))await findAndAttachCover(entry);
  return {entry,duplicate:false};
}
async function writeLimited(stream,dest){let length=0;await pipeline(stream,new Transform({transform(chunk,enc,cb){length+=chunk.length;if(length>MAX_AUDIO_SIZE)cb(Object.assign(new Error('文件超过 100 MB 限制'),{status:413}));else cb(null,chunk);}}),fs.createWriteStream(dest,{flags:'wx'}));}
async function fetchApproved(url,maxRedirects=4,extraHeaders={}){
  let next=url;
  for(let i=0;i<=maxRedirects;i++){
    if(!isApprovedSource(next))throw Object.assign(new Error('音源跳转到未批准的下载域名'),{status:403});
    const response=await fetch(next,{redirect:'manual',signal:AbortSignal.timeout(75000),headers:{'User-Agent':'CloudTune/0.1 (personal local app)',...extraHeaders}});
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');if(!location)throw new Error('音源跳转缺少地址');next=new URL(location,next).href;continue;
    }
    if(!response.ok)throw new Error(`音频服务器返回 HTTP ${response.status}`);
    if(Number(response.headers.get('content-length') || 0)>MAX_AUDIO_SIZE)throw Object.assign(new Error('文件过大'),{status:413});
    const mime=response.headers.get('content-type') || '';
    if(/text\/html|application\/json/i.test(mime))throw new Error('下载地址并未返回音频文件');
    if(!response.body)throw new Error('空文件');
    return response;
  }
  throw new Error('下载重定向次数过多');
}
async function handleDownload(id){
  const item=searchIndex.get(String(id));if(!item || Date.now()-item.cachedAt>1000*60*30)throw Object.assign(new Error('该搜索结果已过期，请重新搜索'),{status:410});
  if(!item.downloadable || !item.url)throw Object.assign(new Error('这条记录只有歌曲信息，没有可下载的音频文件'),{status:400});
  const filename=safeName(`${item.artist && item.artist !== '未知艺术家' ? item.artist+' - ':''}${item.title}.${String(item.format || 'mp3').toLowerCase()}`);
  if(!fileFormat(filename))throw Object.assign(new Error('不支持该音频格式'),{status:400});
  const tmp=path.join(TRACKS,'.'+crypto.randomUUID()+'.part');
  try{const resp=await fetchApproved(item.url);await writeLimited(Readable.fromWeb(resp.body),tmp);return await addFile(tmp,filename,item);}
  finally{await fsp.unlink(tmp).catch(()=>{});}
}
async function handleImport(req,filename){
  filename=safeName(filename);
  if(!fileFormat(filename))throw Object.assign(new Error('仅支持 MP3、FLAC、OGG、WAV、M4A、AAC'),{status:400});
  const tmp=path.join(TRACKS,'.'+crypto.randomUUID()+'.part');
  try{await writeLimited(req,tmp);return await addFile(tmp,filename);}
  finally{await fsp.unlink(tmp).catch(()=>{});}
}
async function updateMetadata(id,form){
  if(uploadInFlight.has(id))throw Object.assign(new Error('该文件正在同步，请完成后再修改信息'),{status:409});
  const entry=tracks.get(String(id));if(!entry)throw Object.assign(new Error('音乐库中不存在该文件'),{status:404});
  const title=cleanField(form.title,100),artist=cleanField(form.artist,80),album=cleanField(form.album,100);
  if(!title || !artist)throw Object.assign(new Error('请填写正确的歌曲名和歌手；不能使用未知艺术家'),{status:400});
  if([title,artist,album].some(x=>/[\r\n]/.test(x)))throw Object.assign(new Error('歌曲信息格式有误'),{status:400});
  const alreadyUploaded=entry.cloudStatus==='uploaded';
  let cover=null;
  if(form.artworkUrl){const candidate=await fetchArtwork(form.artworkUrl);cover=candidate.bytes;}
  if(entry.format==='MP3'){
    const filename=path.join(TRACKS,entry.id+'.mp3');
    const changed=await writeTags(filename,{title,artist,album},cover);
    entry.sha256=changed.sha256;entry.size=changed.size;
  }
  entry.title=title;entry.artist=artist;entry.album=album;
  if(cover){await saveCoverForEntry(entry,cover);}
  else if(!entry.coverExt)await findAndAttachCover(entry);
  if(alreadyUploaded)entry.metadataNeedsResync=true;
  await saveLibrary();return {entry,alreadyUploaded};
}
async function ensureMp3(id){
  const entry=tracks.get(id);if(!entry)throw new Error('本地文件不存在');if(entry.format==='MP3'||entry.cloudStatus==='uploaded')return;
  const ff=locateExecutable('ffmpeg');if(!ff)throw new Error('缺少 FFmpeg，无法转换 MP3');
  const original=path.join(TRACKS,id+'.'+entry.format.toLowerCase()),output=path.join(TRACKS,id+'.mp3.part');
  try{
    await new Promise((resolve,reject)=>{const child=spawn(ff,['-nostdin','-hide_banner','-loglevel','error','-i',original,'-vn','-codec:a','libmp3lame','-q:a','2','-f','mp3','-y',output],{windowsHide:true,stdio:'ignore'});const timer=setTimeout(()=>{child.kill();reject(new Error('MP3 转换超时'));},120000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('音频无法转换为 MP3'));});});
    const stat=await fsp.stat(output);if(stat.size>MAX_AUDIO_SIZE||stat.size<128)throw new Error('转换后的文件大小异常');
    await fsp.rename(output,path.join(TRACKS,id+'.mp3'));entry.format='MP3';entry.size=stat.size;entry.sha256=await hashFile(path.join(TRACKS,id+'.mp3'));await saveLibrary();await fsp.unlink(original).catch(()=>{});
  }finally{await fsp.unlink(output).catch(()=>{});}
}
async function verifyUpload(entry,account={...login}){
  try{entry.cloudSongId=await lookupCloudSongId(getSdk(),account.cookie,entry,entry.uploadResponseIds||{});entry.uploadVerified=true;entry.uploadVerifyError='';}
  catch(e){entry.uploadVerified=false;entry.uploadVerifyError=String(e.message||e).slice(0,280);}
  await saveLibrary();
}
async function retryLike(id,account={...login},fromUpload=false){
  if(fromUpload)return likeEntry(id,account);
  if(uploadInFlight.has(id))throw Object.assign(new Error('该文件正在处理，请稍后重试喜欢'),{status:409});
  uploadInFlight.add(id);try{return await likeEntry(id,account);}finally{uploadInFlight.delete(id);}
}
async function likeEntry(id,account){
  if(!account.cookie)throw Object.assign(new Error('请先连接网易云账号'),{status:401});
  const entry=tracks.get(String(id));if(!entry)throw Object.assign(new Error('歌曲不存在'),{status:404});
  rememberCloud(entry);if(entry.cloudAccountId!==account.userId&&entry.cloudAccounts?.[account.userId])Object.assign(entry,entry.cloudAccounts[account.userId],{cloudAccountId:account.userId});
  if(entry.cloudStatus!=='uploaded')throw Object.assign(new Error('请先将歌曲上传到网易云云盘'),{status:400});
  if(entry.cloudAccountId&&entry.cloudAccountId!==account.userId)throw Object.assign(new Error('此上传记录属于其他账号，请先上传至当前账号'),{status:409});
  if(!entry.cloudAccountId){await verifyUpload(entry,account);if(!entry.uploadVerified)throw Object.assign(new Error('当前账号云盘尚未核验，请先上传或核验'),{status:409});entry.cloudAccountId=account.userId;}
  // Always recheck when explicitly requested, even if an earlier attempt looked successful.

  try{
    const sdk=getSdk();
    if(!account.userId){const r=await sdk.user_account({cookie:account.cookie});account.userId=numberId(r?.body?.profile?.userId || r?.body?.account?.id);}
    const songId=entry.cloudSongId || await lookupCloudSongId(sdk,account.cookie,entry,entry.uploadResponseIds||{});
    entry.cloudSongId=songId;
    const liked=await ensureLiked({sdk,cookie:account.cookie,userId:account.userId,songId});
    entry.likedStatus='liked';entry.likeMethod=liked.method;entry.likedAt=new Date().toISOString();entry.likeError='';
  }catch(e){
    entry.likedStatus='unverified';entry.likeError=String(e.message||'无法确认加入喜欢').slice(0,280);
  }
  await saveLibrary();return {entry,skipped:false};
}
const uploadInFlight=new Set();
async function handleUpload(id){if(uploadInFlight.has(id))throw Object.assign(new Error('该文件正在上传，请等待当前操作完成'),{status:409});uploadInFlight.add(id);try{return await uploadEntry(id);}finally{uploadInFlight.delete(id);}}
async function uploadEntry(id){
  const account={...login};if(!account.cookie)throw Object.assign(new Error('请先连接网易云账号'),{status:401});
  if(!account.userId){const r=await getSdk().user_account({cookie:account.cookie});account.userId=numberId(r?.body?.profile?.userId||r?.body?.account?.id);}
  if(!account.userId)throw Object.assign(new Error('无法确认账号身份，请重新连接后上传'),{status:400});
  const entry=tracks.get(String(id));if(!entry)throw Object.assign(new Error('没有找到文件'),{status:404});
  rememberCloud(entry);
  if(entry.cloudAccountId!==account.userId&&entry.cloudAccounts?.[account.userId])Object.assign(entry,entry.cloudAccounts[account.userId],{cloudAccountId:account.userId});
  if(entry.cloudStatus==='uploaded'&&entry.cloudAccountId!==account.userId){
    if(!entry.cloudAccountId){await verifyUpload(entry,account);if(entry.uploadVerified){entry.cloudAccountId=account.userId;entry.likedStatus='not_liked';}}
    if(entry.cloudAccountId!==account.userId){entry.cloudStatus='local';entry.uploadVerified=false;entry.cloudSongId='';entry.uploadResponseIds={};entry.likedStatus='not_liked';entry.likeError='';}
  }
  if(entry.cloudStatus==='uploaded'){
    if(!entry.uploadVerified)await verifyUpload(entry,account);
    if(settings.autoLike && entry.uploadVerified && entry.likedStatus!=='liked')return {...await retryLike(id,account,true),skipped:true};
    return {entry,skipped:true};
  }
  if(!entry.title?.trim() || !entry.artist?.trim())throw Object.assign(new Error('上传前请点击「编辑信息」，确认歌名与歌手'),{status:400});
  const filename=path.join(TRACKS,entry.id+'.'+entry.format.toLowerCase());
  const data=await fsp.readFile(filename);
  // Upload a user-corrected filename as well as ID3 content, rather than the Bilibili video title.
  const displayFile=safeName(`${entry.artist} - ${entry.title}.${entry.format.toLowerCase()}`);
  const name=Buffer.from(displayFile,'utf8').toString('latin1');
  const res=await getSdk().cloud({songFile:{name,data,mimetype:'audio/'+entry.format.toLowerCase(),size:data.length},cookie:account.cookie});
  const body=res?.body || {};
  if(res.status !== 200 || body.code !== 200)throw new Error(body.msg || body.message || `网易云上传未确认成功（${body.code || res.status || '未知错误'}）`);
  entry.cloudStatus='uploaded';entry.uploadedAt=new Date().toISOString();entry.likedStatus='not_liked';
  entry.cloudAccountId=account.userId;entry.cloudCoverPending=!entry.coverExt;
  entry.uploadFileName=displayFile;
  // Only retain non-secret song ids; upload JSON might include other sensitive data.
  const idCandidate=numberId(body.songId || body.data?.songId || body.data?.simpleSong?.id || body.privateCloud?.songId);
  entry.uploadResponseIds=idCandidate?{songId:idCandidate}:{};
  await saveLibrary();
  await verifyUpload(entry,account);
  if(settings.autoLike && entry.uploadVerified)await retryLike(entry.id,account,true);
  else if(settings.autoLike){entry.likedStatus='unverified';entry.likeError='云盘记录尚未核验，暂未执行喜欢';await saveLibrary();}
  else {entry.likedStatus='disabled';await saveLibrary();}
  return {entry,skipped:false};
}
async function serveStatic(req,res,pathname){
  const routes={'/':'index.html','/app.js':'app.js','/styles.css':'styles.css'};
  const name=routes[pathname];if(!name){json(res,404,{error:'页面不存在'});return;}
  const file=path.join(PUBLIC,name);
  const data=await fsp.readFile(file);
  res.writeHead(200,{'Content-Type':CONTENT_TYPES[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src https://player.bilibili.com; media-src 'self'"});res.end(data);
}
async function route(req,res){
  try{
    const u=new URL(req.url,`http://${HOST}:${PORT}`);
    const p=u.pathname;
    if(req.headers.host!==`${HOST}:${req.socket.localPort}`)throw Object.assign(new Error('只允许本机地址访问'),{status:403});
    // Prevent unrelated websites from making authenticated local API requests.
    if(!['GET','HEAD'].includes(req.method)){
      const origin=req.headers.origin;
      if(origin && origin!==`http://${HOST}:${req.socket.localPort}`)throw Object.assign(new Error('拒绝来自其他网站的请求'),{status:403});
    }
    if(p==='/api/status' && req.method==='GET')return json(res,200,{connected:!!login.cookie,account:login.name,localCount:tracks.size,jamendoConfigured:!!settings.jamendoClientId,autoLike:settings.autoLike!==false,biliTools:biliDownloads.tools(), sdkInstalled:(()=>{try{return !!require.resolve('@neteasecloudmusicapienhanced/api');}catch{return false;}})()});
    if(p==='/api/tasks'&&req.method==='GET')return json(res,200,{tasks:ingestion.list()});
    if(p==='/api/ingest'&&req.method==='POST'){
      const body=await readJson(req,12000);if(!login.cookie)throw Object.assign(new Error('请先连接网易云账号'),{status:401});
      let source=searchIndex.get(String(body.sourceId));
      if(!source&&body.url){const pageUrl=normalizeBiliUrl(body.url);source={id:pageUrl,kind:'bilibili',pageUrl,title:body.metadata?.title||'B站视频'};}
      if(!source)throw Object.assign(new Error('音源已过期，请重新搜索或选择'),{status:410});
      const metadata={title:cleanField(body.metadata?.title,100),artist:cleanField(body.metadata?.artist,80),album:cleanField(body.metadata?.album,100),artworkUrl:typeof body.metadata?.artworkUrl==='string'?body.metadata.artworkUrl:''};
      let task;try{task=ingestion.submit({source:{...source},metadata,confirmedRights:body.confirmedRights});}catch(e){e.status=400;throw e;}
      return json(res,202,{task});
    }
    if(p.startsWith('/api/tasks/')&&req.method==='POST'){
      const parts=p.split('/');if(parts.length!==5)throw new Error('任务操作无效');
      if(parts[4]==='retry'){try{return json(res,200,{task:await ingestion.retry(parts[3])});}catch(e){e.status=400;throw e;}}
      if(parts[4]==='cancel'){await ingestion.cancel(parts[3]);return json(res,200,{ok:true});}
    }
    if(p==='/api/bilibili/tools' && req.method==='GET')return json(res,200,biliDownloads.tools());
    if(p==='/api/bilibili/mp3' && req.method==='POST'){
      const body=await readJson(req,5000);
      if(typeof body.url!=='string'||body.url.length>750)throw Object.assign(new Error('B站链接过长或格式错误'),{status:400});
      if(body.syncToCloud && !login.cookie)throw Object.assign(new Error('请先连接网易云账号，再选择同步云盘'),{status:401});
      return json(res,202,await biliDownloads.start(body));
    }
    if(p.startsWith('/api/bilibili/jobs/') && req.method==='GET')return json(res,200,biliDownloads.get(p.slice('/api/bilibili/jobs/'.length)));
    if(p.startsWith('/api/bilibili/jobs/') && p.endsWith('/cancel') && req.method==='POST')return json(res,200,biliDownloads.cancel(p.slice('/api/bilibili/jobs/'.length,-'/cancel'.length)));
    if(p==='/api/settings' && req.method==='POST'){
      const body=await readJson(req);
      if(Object.hasOwn(body,'jamendoClientId')){if(typeof body.jamendoClientId!=='string'||body.jamendoClientId.length>120)throw Object.assign(new Error('Jamendo Client ID 格式错误'),{status:400});settings.jamendoClientId=body.jamendoClientId.trim();}
      if(Object.hasOwn(body,'autoLike')){if(typeof body.autoLike!=='boolean')throw Object.assign(new Error('自动加入喜欢选项格式错误'),{status:400});settings.autoLike=body.autoLike;}
      await saveSettings();return json(res,200,{saved:true,autoLike:settings.autoLike});
    }
    if(p==='/api/library' && req.method==='GET')return json(res,200,{tracks:Array.from(tracks.values()).reverse().map(entry=>entry.cloudAccounts?.[login.userId]?{...entry,...entry.cloudAccounts[login.userId],cloudAccountId:login.userId}:entry.cloudAccountId&&entry.cloudAccountId!==login.userId?{...entry,cloudStatus:'local',uploadVerified:false,likedStatus:'',cloudSongId:''}:entry)});
    if(p==='/api/metadata/suggest' && req.method==='GET'){const q=cleanField(u.searchParams.get('q'),100);if(q.length<2)throw Object.assign(new Error('请先输入歌曲名称'),{status:400});return json(res,200,{suggestions:await metadataSearch(q)});}
    if(p==='/api/metadata/recognize' && req.method==='POST'){
      const body=await readJson(req,7000);let input={title:cleanText(body.title,300),artist:cleanText(body.artist,80),videoTitle:cleanText(body.videoTitle,300),description:cleanText(body.description,1800)};
      if(body.url){try{input={...input,...await videoEvidence(body.url)};}catch(e){if(e.status===400)throw e;}}
      if(!(input.videoTitle||input.title))throw Object.assign(new Error('请填写歌曲标题或有效的 B站视频链接'),{status:400});
      return json(res,200,await recognizeMetadata(input,metadataSearch));
    }
    if(p==='/api/artwork' && req.method==='GET'){
      const cover=await fetchArtwork(u.searchParams.get('url'));res.writeHead(200,{'Content-Type':cover.mime,'Content-Length':cover.bytes.length,'Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'});return res.end(cover.bytes);
    }
    if(p==='/api/library/metadata' && req.method==='POST'){const body=await readJson(req,4000);return json(res,200,await updateMetadata(body.id,body));}
    if(p==='/api/library/cover' && req.method==='POST'){
      const id=u.searchParams.get('id');const entry=tracks.get(id);
      if(uploadInFlight.has(id))throw Object.assign(new Error('该文件正在同步，请完成后再修改封面'),{status:409});
      if(!entry)throw Object.assign(new Error('找不到该歌曲'),{status:404});
      const contentLength=Number(req.headers['content-length']||0);
      if(contentLength>MAX_COVER_SIZE)throw Object.assign(new Error('封面不能超过2MB'),{status:413});
      let chunks=[],total=0;
      for await(const part of req){total+=part.length;if(total>MAX_COVER_SIZE)throw Object.assign(new Error('封面不能超过2MB'),{status:413});chunks.push(part);}
      return json(res,200,{entry:await saveCoverForEntry(entry,Buffer.concat(chunks))});
    }
    if(p.startsWith('/api/cover/') && req.method==='GET'){
      const id=p.slice('/api/cover/'.length);const entry=tracks.get(id);
      if(!entry)return json(res,404,{error:'封面不存在'});
      let bytes=null;
      if(entry.coverExt){bytes=await fsp.readFile(path.join(COVERS,id+'.'+entry.coverExt)).catch(()=>null);}
      if(!bytes && entry.format==='MP3'){
        const track=path.join(TRACKS,id+'.mp3');
        const handle=await fsp.open(track,'r').catch(()=>null);
        if(handle){try{const head=Buffer.alloc(10);await handle.read(head,0,10,0);const size=head.toString('ascii',0,3)==='ID3'?Math.min(4*1024*1024,10+((head[6]<<21)|(head[7]<<14)|(head[8]<<7)|head[9])):0;
          if(size){const buf=Buffer.alloc(size);await handle.read(buf,0,size,0);bytes=extractCover(buf);}
        }finally{await handle.close();}}
      }
      if(!bytes)return json(res,404,{error:'没有封面图片'});
      const image=detectImage(bytes);res.writeHead(200,{'Content-Type':image.mime,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
    }
    if(p.startsWith('/api/source/listen/')&&req.method==='GET'){
      const item=searchIndex.get(p.slice('/api/source/listen/'.length));if(!item||Date.now()-item.cachedAt>1800000)throw Object.assign(new Error('试听音源已过期，请重新搜索'),{status:410});
      if(!item.downloadable||!item.url)throw Object.assign(new Error('此来源没有可试听音频'),{status:400});
      const range=req.headers.range;if(range&&!/^bytes=\d+-\d*$/.test(range))throw Object.assign(new Error('不支持的音频范围'),{status:416});
      const response=await fetchApproved(item.url,4,range?{Range:range}:{});
      const headers={'Content-Type':response.headers.get('content-type')||'audio/mpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      for(const name of ['content-length','content-range','accept-ranges'])if(response.headers.get(name))headers[name]=response.headers.get(name);
      res.writeHead(response.status,headers);let length=0;
      try{await pipeline(Readable.fromWeb(response.body),new Transform({transform(chunk,enc,cb){length+=chunk.length;cb(length>MAX_AUDIO_SIZE?new Error('试听超过文件大小限制'):null,chunk);}}),res);}catch{res.destroy();}return;
    }
    if(p.startsWith('/api/listen/') && req.method==='GET'){
      const id=p.slice('/api/listen/'.length);const entry=tracks.get(id);
      if(!entry)return json(res,404,{error:'音频不存在'});
      const filepath=path.join(TRACKS,id+'.'+entry.format.toLowerCase());
      const stat=await fsp.stat(filepath);const total=stat.size;
      const mime={MP3:'audio/mpeg',WAV:'audio/wav',FLAC:'audio/flac',OGG:'audio/ogg',OGA:'audio/ogg',M4A:'audio/mp4',AAC:'audio/aac'}[entry.format]||'application/octet-stream';
      const base={'Content-Type':mime,'Accept-Ranges':'bytes','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
      const range=req.headers.range;
      if(range){const match=/^bytes=(\d*)-(\d*)$/.exec(range);
        if(!match)return json(res,416,{error:'不支持的音频范围请求'});
        let start=match[1]?Number(match[1]):null,end=match[2]?Number(match[2]):null;
        if(start===null){const tail=end;if(tail===null||tail<=0)return json(res,416,{error:'音频范围无效'});start=Math.max(0,total-tail);end=total-1;}
        else end=end===null?total-1:Math.min(end,total-1);
        if(start>=total || start>end)return json(res,416,{error:'音频范围超出文件长度'});
        res.writeHead(206,{...base,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${total}`});
        return fs.createReadStream(filepath,{start,end}).pipe(res);
      }
      res.writeHead(200,{...base,'Content-Length':total});return fs.createReadStream(filepath).pipe(res);
    }
    if(p==='/api/search' && req.method==='GET'){
      const q=cleanText(u.searchParams.get('q')||'',1500);
      if(q.length<2)throw Object.assign(new Error('至少输入2个字符'),{status:400});
      let hits,errors=[];
      if(/^https?:\/\//i.test(q)){
        if(/bilibili\.com/.test(q)){const pageUrl=normalizeBiliUrl(q);let evidence={};try{evidence=await videoEvidence(pageUrl);}catch{errors.push('B站资料暂不可用，可试听链接并手动确认信息');}hits=[{id:crypto.randomUUID(),kind:'bilibili',title:evidence.videoTitle||'B站视频',description:evidence.description,artist:evidence.uploader||'B站 UP主',source:'B站 · 视频链接',pageUrl,bvid:pageUrl.match(/BV[\da-zA-Z]{10}/)?.[0]||'',format:'视频',downloadable:false}];}
        else if(isApprovedSource(q)&&fileFormat(q)){hits=[{id:crypto.randomUUID(),title:path.basename(new URL(q).pathname),artist:'待确认',source:'音频链接',kind:'audio',url:q,pageUrl:q,format:fileFormat(q).toUpperCase(),downloadable:true}];}
        else throw Object.assign(new Error('暂不支持此链接，请输入歌名或支持的 B站完整链接'),{status:400});
      }else ({hits,errors}=await searchAll(q,settings.jamendoClientId));
      hits=rankSources(q,hits);
      searchIndex.clear();hits.forEach(x=>searchIndex.set(x.id,{...x,cachedAt:Date.now()}));
      return json(res,200,{results:hits.map(({url,...safe})=>safe),errors});
    }
    if(p==='/api/download' && req.method==='POST'){
      const body=await readJson(req);return json(res,200,await handleDownload(body.id));
    }
    if(p==='/api/import' && req.method==='POST')return json(res,200,await handleImport(req,u.searchParams.get('filename')));
    if(p.startsWith('/api/file/') && req.method==='GET'){
      const id=p.slice('/api/file/'.length);const item=tracks.get(id);if(!item)return json(res,404,{error:'文件不存在'});
      const filename=path.join(TRACKS,item.id+'.'+item.format.toLowerCase());
      const stat=await fsp.stat(filename);
      res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(item.name)}`,'X-Content-Type-Options':'nosniff'});
      fs.createReadStream(filename).pipe(res);return;
    }
    if(p==='/api/login/session' && req.method==='POST'){
      const body=await readJson(req,7000);
      const input=String(body.cookie || '').trim();
      const match=input.match(/(?:^|;\s*)MUSIC_U=([^;\s]+)/);
      if(!match || match[1].length<16 || match[1].length>2500)throw Object.assign(new Error('请输入你自己的 MUSIC_U Cookie（格式：MUSIC_U=...）'),{status:400});
      // Never log or return the session secret; persist only through Windows DPAPI.
      const cookie='MUSIC_U='+match[1];
      const sdk=getSdk();
      let remote;
      try{remote=await sdk.user_account({cookie});}catch{throw Object.assign(new Error('登录验证请求失败，请检查网络或网易云接口'),{status:502});}
      const profile=remote?.body?.profile;
      if(!profile?.userId && !profile?.nickname)throw Object.assign(new Error('会话未通过网易云账号验证：可能已失效，请重新从官方网站获取'),{status:401});
      const connected={cookie,key:'',name:profile.nickname || '已连接',userId:numberId(profile.userId || remote?.body?.account?.id)};
      await sessionStore.save(connected);login=connected;
      return json(res,200,{connected:true,account:login.name});
    }
    if(p==='/api/login/start' && req.method==='POST'){
      const sdk=getSdk();const keyRes=await sdk.login_qr_key({});
      const key=keyRes.body?.data?.unikey;
      if(!key)throw new Error('获取网易云登录二维码失败');
      login.key=key;const qr=await sdk.login_qr_create({key,qrimg:true});
      return json(res,200,{qrimg:qr.body?.data?.qrimg,qrurl:qr.body?.data?.qrurl});
    }
    if(p==='/api/login/poll' && req.method==='GET'){
      if(!login.key)return json(res,200,{code:800,message:'请先生成二维码'});
      const sdk=getSdk();let r;
      try{r=await sdk.login_qr_check({key:login.key});}
      catch(e){if(e?.status===502 || e?.body?.code===502)r=await sdk.login_qr_check({key:login.key,noCookie:true});else throw e;}
      if(r?.status===502 || r?.body?.code===502)r=await sdk.login_qr_check({key:login.key,noCookie:true});
      const data=r.body || {};const code=Number(data.code);
      if(code===803 && typeof data.cookie==='string' && data.cookie.length){
        const connected={cookie:data.cookie,key:'',name:'已连接',userId:''};
        try{const profile=await sdk.user_account({cookie:connected.cookie});connected.name=profile.body?.profile?.nickname || '已连接';connected.userId=numberId(profile.body?.profile?.userId || profile.body?.account?.id);}catch{}
        await sessionStore.save(connected);login=connected;
      }
      if(code===800)login.key='';
      if(code===803 && !login.cookie)return json(res,200,{code:803,message:'扫码授权完成，但第三方接口没有返回登录凭证。请尝试「网页登录会话连接」。',connected:false});
      return json(res,200,{code,message:code===803?'连接成功':code===802?'已扫码，请在手机确认':code===801?'等待扫码':code===800?'二维码已过期':'请重试',connected:!!login.cookie,account:login.name});
    }
    if(p==='/api/logout' && req.method==='POST'){await sessionStore.clear();login={cookie:'',key:'',name:'',userId:''};return json(res,200,{ok:true});}
    if(p==='/api/cloud/upload' && req.method==='POST'){const body=await readJson(req);return json(res,200,await handleUpload(body.id));}
    if(p==='/api/cloud/like' && req.method==='POST'){const body=await readJson(req);return json(res,200,await retryLike(body.id));}
    if(p==='/api/cloud/list' && req.method==='GET'){
      if(!login.cookie)throw Object.assign(new Error('请先登录'),{status:401});
      const r=await getSdk().user_cloud({cookie:login.cookie,limit:50,offset:0});
      const body=r.body||{};
      if(body.code!==200)throw new Error(body.msg || '网易云云盘列表获取失败');
      return json(res,200,{songs:(body.data||[]).slice(0,50).map(x=>({name:x.songName || x.simpleSong?.name || '未命名',artist:x.artist || x.simpleSong?.ar?.map(a=>a.name).join(', ') || ''})),count:body.count});
    }
    if(!p.startsWith('/api/') && req.method==='GET')return await serveStatic(req,res,p);
    return methodNotAllowed(res);
  }catch(e){return error(res,e);}
}
async function start(port=PORT,control={}){
  await init();
  const server=http.createServer((req,res)=>{
    const local=`${HOST}:${req.socket.localPort}`;
    if(req.url==='/api/health' && req.method==='GET' && req.headers.host===local)return json(res,200,{app:'CloudTune',instanceId:control.instanceId || '',version:require('./package.json').version});
    if(req.url==='/api/app/stop' && req.method==='POST'){
      if(req.headers.host!==local || (req.headers.origin && req.headers.origin!==`http://${local}`) || !control.controlToken || req.headers['x-cloudtune-control']!==control.controlToken)return json(res,403,{error:'无权停止本地服务'});
      json(res,200,{ok:true});setImmediate(()=>server.cloudTuneStop());return;
    }
    route(req,res);
  });
  server.cloudTuneStop=async()=>{await ingestion.close();biliDownloads.shutdown();server.close();server.closeAllConnections();};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,HOST,()=>{server.removeListener('error',reject);resolve();});});
  console.log(`CloudTune 已启动：http://${HOST}:${server.address().port}`);return server;
}
if(require.main===module)start().catch(e=>{console.error(e);process.exit(1)});
module.exports={start,safeName,fileFormat,readJson,fetchApproved};


