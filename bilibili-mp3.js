'use strict';
/** Local, user-authorized Bilibili audio conversion (no DRM or login bypass). */
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {spawn,spawnSync} = require('node:child_process');
const {randomUUID} = require('node:crypto');
const {cleanText,MAX_AUDIO_SIZE} = require('./sources');
const {titleFromVideo}=require('./mp3-tags');

const ERROR_LIMIT=700;
const JOB_LIMIT=1;
const MAX_RUNTIME_MS=12*60*1000;
// Short-lived signed media URLs remain in memory, never in the library or task records.
const inspected=new Map();
async function resolvePublicAudio(input,{fetchImpl=fetch,signal}={}){
  const page=new URL(normalizeBiliUrl(input));const id=page.pathname.split('/')[2];
  const headers={'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'};
  async function request(endpoint,params){
    const u=new URL(endpoint,'https://api.bilibili.com');u.search=new URLSearchParams(params).toString();
    // Public JSON endpoints accept normal API requests; browser headers are only
    // needed by the media CDN, and provoke 412 on the view endpoint here.
    const response=await fetchImpl(u.href,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error(`公开音源接口 HTTP ${response.status}，未开始下载`);
    const data=await response.json();if(Number(data.code)!==0)throw new Error('公开音源接口未提供可用音轨（返回 '+String(data.code)+'）');return data.data;
  }
  const view=await request('/x/web-interface/view',id.startsWith('BV')?{bvid:id}:{aid:id.slice(2)});
  const rights=view?.rights||{};
  if(rights.download===0||['pay','ugc_pay','arc_pay','movie'].some(k=>Number(rights[k])>0)||view?.is_live)throw new Error('该视频存在下载或内容访问限制，未开始下载');
  const part=view?.pages?.[Number(page.searchParams.get('p')||1)-1];
  if(!part?.cid)throw new Error('未找到指定分P的音轨');
  if(Number(part.duration||view.duration)>3600)throw new Error('不支持超过一小时的音源');
  const play=await request('/x/player/playurl',{bvid:view.bvid,cid:String(part.cid),qn:'64',fnval:'16',fnver:'0',fourk:'0'});
  const audio=(play?.dash?.audio||[]).slice(0,16).filter(a=>{
    try{const u=new URL(a.baseUrl||a.base_url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname.endsWith('.bilivideo.com')&&/^mp4a\./.test(a.codecs);}catch{return false;}
  }).sort((a,b)=>Number(b.bandwidth||0)-Number(a.bandwidth||0))[0];
  if(!audio)throw new Error('公开音源接口没有提供可用的 AAC 音轨');
  const duration=Number(play.timelength)/1000||Number(part.duration)||0;
  if(duration>3600)throw new Error('不支持超过一小时的音源');
  return {id:String(view.bvid),title:cleanText(view.title),duration,webpage_url:page.href,extractor:'bilibili:public',url:audio.baseUrl||audio.base_url,ext:'m4a',acodec:audio.codecs,vcodec:'none',abr:Number(audio.bandwidth||0)/1000,http_headers:headers};
}
const regexVideo=/^\/(?:video)\/(BV[a-zA-Z0-9]{10}|av\d{1,15})\/?$/;
function normalizeBiliUrl(input){
  let u;
  try{u=new URL(String(input||'').trim());}catch{throw Object.assign(new Error('请粘贴 B站视频完整链接，例如 https://www.bilibili.com/video/BV...'),{status:400});}
  if(u.protocol!=='https:' || !['www.bilibili.com','bilibili.com'].includes(u.hostname) || u.username || u.password || u.port || !regexVideo.test(u.pathname)){
    throw Object.assign(new Error('目前只支持 https://www.bilibili.com/video/BV... 视频链接（不支持短链、合集、番剧或付费内容）'),{status:400});
  }
  let clean='https://www.bilibili.com'+u.pathname;
  const p=u.searchParams.get('p');
  if(p){if(!/^[1-9]\d{0,2}$/.test(p))throw Object.assign(new Error('分P参数不正确'),{status:400});clean+='?p='+p;}
  return clean;
}
function locateExecutable(name,opts={}){
  const root=opts.root || __dirname;
  const ext=process.platform==='win32'?'.exe':'';
  const expected=path.join(root,'tools',name+ext);
  if(fs.existsSync(expected))return expected;
  const configured=name==='yt-dlp'?process.env.CLOUDTUNE_YTDLP:process.env.CLOUDTUNE_FFMPEG;
  if(configured && fs.existsSync(configured))return configured;
  const cmd=name==='yt-dlp'?'yt-dlp':name;
  const look=process.platform==='win32'?'where':'which';
  const result=spawnSync(look,[cmd],{encoding:'utf8',timeout:2000,windowsHide:true});
  return result.status===0 ? cmd : '';
}
function toolsStatus(opts={}){
  const yt=locateExecutable('yt-dlp',opts);const ff=locateExecutable('ffmpeg',opts);
  return {ready:!!yt && !!ff,ytDlp:!!yt,ffmpeg:!!ff};
}
function inspectionError(output){
  const code=String(output).match(/HTTP(?:\s+Error)?\s+(\d{3})/i)?.[1];
  if(code==='412')return 'B站返回 HTTP 412，拒绝了下载组件的请求；未开始下载。请换一个音源，或将已有音频导入本地库。';
  if(code)return `B站音源检查返回 HTTP ${code}；未开始下载，请在来源网站确认视频是否可访问或换音源。`;
  if(/timed?\s*out|timeout/i.test(output))return '音源检查连接超时，请确认网络与代理运行正常后重试。';
  if(/resolve|name resolution|DNS|getaddrinfo/i.test(output))return '下载组件无法解析 B站地址，请确认代理和网络后重试。';
  if(/certificate|SSL/i.test(output))return '下载组件的安全连接验证失败，请检查网络环境后重试。';
  if(/login|sign in|membership|premium|cookies|DRM/i.test(output))return '当前音源需要登录或受平台访问限制，未开始下载，请换音源。';
  return '下载组件未能取得音源信息，未开始下载；请检查网络或选择其他音源。';
}
async function inspectSource(url,{root=__dirname,spawnImpl=spawn,fetchImpl=fetch,signal,onProgress,timeoutMs=45000,progressIntervalMs=5000}={}){
  if(signal?.aborted)throw new Error('音源检查已取消');
  const yt=locateExecutable('yt-dlp',{root});if(!yt)throw new Error('缺少 yt-dlp，无法检查音源');
  const args=['--ignore-config','--no-playlist','--no-cache-dir','--skip-download','--dump-single-json','--no-warnings','--socket-timeout','15','--retries','1','--format','bestaudio/best','--',normalizeBiliUrl(url)];
  return new Promise((resolve,reject)=>{
    const child=spawnImpl(yt,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});let output='',stderr='',settled=false;const started=Date.now();
    const report=()=>{if(!settled&&onProgress)Promise.resolve(onProgress(`检查音源中（已等 ${Math.floor((Date.now()-started)/1000)} 秒，最多 ${Math.ceil(timeoutMs/1000)} 秒）；通过后自动下载`)).catch(()=>{});};
    const fallbackController=new AbortController();
    const finish=(err,result)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(heartbeat);fallbackController.abort();signal?.removeEventListener('abort',abort);err?reject(err):resolve(result);};
    const abort=()=>{child.kill();finish(new Error('音源检查已取消'));};
    const timer=setTimeout(()=>{child.kill();finish(new Error('音源检测超时，已停止检查，未开始下载；请检查代理或换音源。'));},timeoutMs);
    const heartbeat=setInterval(report,progressIntervalMs);report();
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout?.on('data',b=>{if(settled)return;output+=b.toString();if(output.length>4*1024*1024){child.kill();finish(new Error('音源检测响应过大'));}});child.stderr?.on('data',b=>{stderr=(stderr+b.toString()).slice(-8000);});
    child.once('error',()=>finish(new Error('无法运行音源检查组件')));
    child.once('close',async code=>{if(settled)return;if(code!==0){
      if(!/HTTP(?:\s+Error)?\s+412/i.test(stderr))return finish(new Error(inspectionError(stderr)));
      try{
        if(onProgress)await onProgress('网页音源检查受限，正在通过公开视频音轨接口检查；通过后自动下载');
        const info=await resolvePublicAudio(url,{fetchImpl,signal:fallbackController.signal});
        if(settled)return;if(inspected.size>=20)inspected.delete(inspected.keys().next().value);
        inspected.set(normalizeBiliUrl(url),{at:Date.now(),info});
        return finish(null,{duration:info.duration,format:info.ext,audioCodec:info.acodec,bitrate:info.abr});
      }catch(e){return finish(new Error('网页检查返回 HTTP 412；'+(e.message||'公开音轨检查失败')));}
    }
      try{const info=JSON.parse(output);if(info.has_drm||info.is_live||info._type==='playlist'||Number(info.duration)>3600)throw new Error('不支持受保护内容、直播、合集或超过一小时的音源');if(!info.url&&!Array.isArray(info.formats)&&!info.requested_formats)throw new Error('没有检测到可获取的音轨');if(inspected.size>=20)inspected.delete(inspected.keys().next().value);inspected.set(normalizeBiliUrl(url),{at:Date.now(),info:null});finish(null,{duration:Number(info.duration)||null,format:String(info.ext||''),audioCodec:String(info.acodec||''),bitrate:Number(info.abr)||null});}
      catch(e){finish(new Error('音源检查失败：'+e.message));}
    });
  });
}
function convertArguments(url,outTemplate,ffmpeg){
  const args=['--ignore-config','--no-playlist','--no-cache-dir','--no-write-info-json','--no-write-thumbnail','--no-write-subs','--no-write-auto-subs','--no-mtime','--newline',
    '--extract-audio','--audio-format','mp3','--audio-quality','0','--format','bestaudio/best',
    '--max-filesize','100M','--match-filter','duration <= 3600',
    '--socket-timeout','25','--retries','2','--fragment-retries','2',
    '--output',outTemplate];
  // yt-dlp invokes ffmpeg for transcoding; provide explicit local location if needed.
  if(ffmpeg && (path.isAbsolute(ffmpeg) || ffmpeg.includes(path.sep)))args.push('--ffmpeg-location',ffmpeg);
  args.push('--',normalizeBiliUrl(url));
  return args;
}
function publicJob(j){return {id:j.id,stage:j.stage,message:j.message,progress:j.progress,entry:j.entry,duplicate:j.duplicate,cloudUploaded:j.cloudUploaded,likedStatus:j.likedStatus,error:j.error,createdAt:j.createdAt};}
function manager({tracksDir,addFile,uploadToCloud,root=__dirname,spawnImpl=spawn,fetchImpl=fetch,now=Date.now}){
  const jobs=new Map();let running=0;
  async function start({url,title,artist,album,artworkUrl,syncToCloud}){
    const normalized=normalizeBiliUrl(url);
    if(running>=JOB_LIMIT)throw Object.assign(new Error('已有 B站下载任务在运行，请等待完成后再试'),{status:429});
    const yt=locateExecutable('yt-dlp',{root});const ff=locateExecutable('ffmpeg',{root});
    if(!yt || !ff)throw Object.assign(new Error('缺少下载组件：请先安装 yt-dlp 和 FFmpeg，然后重启 CloudTune。设置页有安装说明。'),{status:503});
    if(jobs.size>60)for(const [id,j] of jobs)if(j.stage==='done'||j.stage==='error'||j.stage==='cancelled')jobs.delete(id);
    const id=randomUUID();const t=cleanText(titleFromVideo(title)||'B站音频',100)||'B站音频';const a=cleanText(artist||'',80);
    if(syncToCloud && (!t || t==='B站音频' || !a))throw Object.assign(new Error('同步前请先填写准确的歌曲名和歌手，避免云盘出现「未知艺术家」'),{status:400});
    const workdir=path.join(tracksDir,'.bili-'+id);
    const job={id,likedStatus:'not_liked',createdAt:new Date(now()).toISOString(),stage:'starting',message:'准备下载 B站音频…',progress:0,error:'',entry:null,duplicate:false,cloudUploaded:false,child:null,cancelled:false,controller:new AbortController()};
    jobs.set(id,job);running++;
    // start() immediately returns a job id, while the asynchronous worker runs.
    void (async()=>{
      let last='';
      try{
        await fsp.mkdir(workdir,{recursive:true});
        if(job.cancelled)throw new Error('用户取消了下载');
        let cached=inspected.get(normalized);
        if(!cached||Date.now()-cached.at>4*60*1000){
          job.stage='inspecting';await inspectSource(normalized,{root,spawnImpl,fetchImpl,signal:job.controller.signal,onProgress:message=>{job.message=message;}});cached=inspected.get(normalized);
        }
        if(job.cancelled)throw new Error('用户取消了下载');
        const args=convertArguments(normalized,path.join(workdir,'audio.%(ext)s'),ff);
        if(cached?.info&&Date.now()-cached.at<=4*60*1000){
          const manifest=path.join(workdir,'source.json');await fsp.writeFile(manifest,JSON.stringify(cached.info));
          args.splice(-2,2,'--load-info-json',manifest);
        }
        await new Promise((resolve,reject)=>{
          const child=spawnImpl(yt,args,{cwd:root,windowsHide:true,env:process.env,stdio:['ignore','pipe','pipe'],shell:false});
          job.child=child;job.stage='downloading';job.message='正在连接并下载音轨…';
          const timer=setTimeout(()=>{child.kill();reject(new Error('下载超时（12分钟），请稍后重试'))},MAX_RUNTIME_MS);
          let settled=false;
          function finish(err){if(settled)return;settled=true;clearTimeout(timer);if(err)reject(err);else resolve();}
          const update=chunk=>{
            last=(last+chunk.toString('utf8')).slice(-ERROR_LIMIT);
            if(/\[ExtractAudio\]|\[ffmpeg\]/i.test(last)){job.stage='converting';job.message='正在转换 MP3…';job.progress=95;}
            else if(/\[download\]/i.test(last) && job.stage!=='converting'){
              job.stage='downloading';
              const m=last.match(/\[download\]\s+(\d{1,3}(?:\.\d+)?)%/);
              if(m){job.progress=Math.min(94,Math.max(job.progress,Math.floor(Number(m[1])*0.9)));job.message='正在下载音轨 '+m[1]+'%';}
            }
          };
          child.stdout?.on('data',update);child.stderr?.on('data',update);
          child.once('error',err=>finish(new Error('无法运行 yt-dlp：'+err.message)));
          child.once('close',(code,signal)=>{
            if(job.cancelled)return finish(new Error('用户取消了下载'));
            if(code===0)return finish();
            const reason=/login|cookies|sign in|membership|premium|DRM|403|412|429/i.test(last)?'B站拒绝了这次请求，可能需要登录、限流或当前内容不可直接获取。不会尝试绕过限制。':
              'B站音频提取失败，请确认视频公开可访问、组件为最新版本，并检查网络连接。';
            finish(new Error(reason+' (退出码 '+code+')'));
          });
        });
        if(job.cancelled)throw new Error('用户取消了下载');
        const mp3=path.join(workdir,'audio.mp3');
        const st=await fsp.stat(mp3).catch(()=>null);
        if(!st?.isFile()||st.size<128)throw new Error('没有得到有效的 MP3 文件，请确认 FFmpeg 已安装');
        if(st.size>MAX_AUDIO_SIZE)throw new Error('MP3 超过 100MB 上限，已停止导入');
        job.stage='saving';job.message='正在保存到我的音乐库…';job.progress=97;
        const entry=await addFile(mp3,`${a ? a+' - ' : ''}${t}.mp3`,{title:t,artist:a,album:cleanText(album||'',100),artworkUrl:artworkUrl||'',source:'B站 · 已授权音频',pageUrl:normalized,license:'由用户确认具有保存权限'});
        job.entry=entry.entry;job.duplicate=entry.duplicate;
        if(syncToCloud){
          job.stage='uploading';job.message='已保存 MP3，正在上传网易云云盘…';job.progress=98;
          try{const uploaded=await uploadToCloud(entry.entry.id);job.cloudUploaded=true;job.likedStatus=uploaded.entry.likedStatus;job.entry=uploaded.entry;}
          catch(e){job.message='MP3 已保存，云盘上传失败：'+(e.message||'未知错误')+'；可以在音乐库重试';}
        }
        job.stage='done';job.progress=100;if(!job.message.includes('云盘上传失败'))job.message=syncToCloud?(job.likedStatus==='liked'?'MP3 已上传云盘，并已验证加入「我喜欢的音乐」':'MP3 已上传云盘；自动喜欢未完成，请在音乐库查看状态'):'MP3 已保存到音乐库';
      }catch(err){job.stage=job.cancelled?'cancelled':'error';job.error=job.cancelled?'下载已取消':String(err.message||'下载失败').slice(0,350);job.message=job.error;}
      finally{job.child=null;running--;await fsp.rm(workdir,{recursive:true,force:true}).catch(()=>{});}
    })();
    return {id,stage:job.stage};
  }
  function get(id){const x=jobs.get(String(id));if(!x)throw Object.assign(new Error('任务不存在或已过期'),{status:404});return publicJob(x);}
  function cancel(id){const x=jobs.get(String(id));if(!x)throw Object.assign(new Error('任务不存在'),{status:404});if(['done','error','cancelled'].includes(x.stage))return publicJob(x);x.cancelled=true;x.controller.abort();x.child?.kill();return publicJob(x);}
  function shutdown(){
    for(const job of jobs.values())if(!['done','error','cancelled'].includes(job.stage)){
      // yt-dlp starts FFmpeg as a descendant. End the owned process tree on Windows.
      if(process.platform==='win32' && job.child?.pid && job.child.exitCode===null){
        spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'),['/PID',String(job.child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore',timeout:5000});
      }
      cancel(job.id);
    }
  }
  return {start,get,cancel,shutdown,tools:()=>toolsStatus({root})};
}
module.exports={normalizeBiliUrl,locateExecutable,toolsStatus,convertArguments,inspectSource,resolvePublicAudio,manager};
