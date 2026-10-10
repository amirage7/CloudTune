'use strict';
const $=id=>document.getElementById(id);
const state={results:[],library:[],selected:new Set(),queue:[],connected:false,account:'',qrTimer:null,searching:false,busy:new Set(),filter:"usable",biliTools:null,autoLike:true,metadataEditId:null,artworkUrl:"",coverFile:null,coverObjectUrl:""};
const safeUrl = url=> {try {const u=new URL(url);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}};
function node(tag,cls,txt){const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=String(txt);return e;}
function button(cls,label,fn){const e=node('button',cls,label);e.type='button';e.addEventListener('click',fn);return e;}
function fmtSize(num){if(!num)return '未知大小';return (num/1048576).toFixed(1)+' MB';}
function likedLabel(item){return item.likedStatus==='liked'?(item.likeMethod==='playlist'?'♥ 已加入喜欢歌单':'♥ 已加入我喜欢'):item.cloudStatus!=='uploaded'?'':item.likedStatus==='disabled'?'自动喜欢未开启':'♡ 喜欢待核实';}
function uploadLabel(entry){if(entry.cloudStatus==='uploaded'&&!entry.uploadVerified)return '上传已提交，云盘待核验';if(entry.likedStatus==='liked')return '云盘与喜欢已核验';return entry.cloudStatus==='uploaded'?'云盘已核验，喜欢待核实':'已保存到本地';}
function cleanVideoTitle(s){const v=String(s||'');return ((v.match(/[《“「]([^》”」]{1,65})[》”」]/)||[])[1]||v.replace(/【[^】]*(?:无损|Hi.Res|MV|超清)[^】]*】/gi,'').replace(/\[[^\]]*(?:Hi.Res|无损|MV|高音质)[^\]]*\]/gi,'')).slice(0,100).trim();}
function createCover(src,cls='result-cover',fallback='♫'){
  const box=node('div',cls);
  if(src){const img=node('img','cover-image');img.alt='歌曲或视频封面';img.loading='lazy';img.referrerPolicy='no-referrer';img.src=src;
    img.addEventListener('error',()=>{box.replaceChildren(node('span','',fallback));});box.append(img);
  }else box.append(node('span','',fallback));
  return box;
}
function openPlayer({title,artist,url,bvid,id,pageUrl,kind}){
  $('player-modal').classList.remove('video-player','collapsed');
  const box=$('player-stage');box.replaceChildren();$('player-title').textContent=title||'站内试听';
  $('player-detail').textContent=artist||'选中资源';
  const fallback=$('player-fallback');fallback.classList.add('hidden');fallback.removeAttribute('href');
  // Search results also carry ids; select the video source before local files.
  if(/^BV[0-9A-Za-z]{10}$/.test(bvid||'')){
    $('player-modal').classList.add('video-player','collapsed');
    if($('player-expand'))$('player-expand').textContent='展开详情';
    const iframe=node('iframe','bili-iframe');iframe.src='https://player.bilibili.com/player.html?bvid='+encodeURIComponent(bvid)+'&page=1&high_quality=1';
    iframe.title=title||'B站视频播放器';iframe.referrerPolicy='strict-origin-when-cross-origin';iframe.allow='autoplay; fullscreen; picture-in-picture';iframe.allowFullscreen=true;
    box.append(iframe);$('player-note').textContent='使用 B站官方嵌入播放器；可能需要你点击播放。若因平台限制无法播放，请使用备用来源链接。';
    if(safeUrl(pageUrl)){fallback.href=pageUrl;fallback.classList.remove('hidden');}
  }else if(id && kind!=='bilibili' && !bvid){
    if(typeof discovery!=='undefined')discovery.preview=null;
    const audio=node('audio','local-audio');audio.controls=true;audio.preload='metadata';
    $('player-note').textContent='正在加载本地音频…';
    audio.addEventListener('loadedmetadata',()=>{$('player-note').textContent='音频已加载，点击播放按钮开始试听。';});
    audio.addEventListener('playing',()=>{$('player-note').textContent=url==='/api/source/listen/'?'正在试听选定音源；不会保存或上传。':'正在播放 CloudTune 本地音乐库中的文件。';});
    audio.addEventListener('error',()=>{
      $('player-note').textContent=audio.error?.code===4?'加载失败：文件不存在或浏览器不支持此音频格式。请检查音乐文件，或下载后用本地播放器打开。':'音频加载失败，请检查本地服务是否仍在运行，以及音乐文件是否完整。';
    });
    audio.src=(url==='/api/source/listen/'?url:'/api/listen/')+encodeURIComponent(id);box.append(audio);
  }else{box.append(emptyMessage('暂不能站内播放','此搜索结果没有可用的本地音频或 B站视频 ID。'));$('player-note').textContent='没有可播放的音频或视频，请重新搜索。';}
  $('player-modal').classList.remove('hidden');
  if(document.body?.style)document.body.style.paddingBottom=/^BV[0-9A-Za-z]{10}$/.test(bvid||'')?'290px':'210px';
}
function closePlayer(){const el=$('player-stage');el.replaceChildren();$('player-modal').classList.add('hidden');if(document.body?.style)document.body.style.paddingBottom='110px';}
let biliProposal=null,biliRecognitionSequence=0;
function artworkPreview(url){return url?'/api/artwork?url='+encodeURIComponent(url):'';}
function showRecognitionSources(rows){
  const box=$('bili-recognition-sources');box.replaceChildren();
  (rows||[]).forEach(source=>{const href=safeUrl(source.url);if(!href)return;const link=node('a','text-btn',source.title+' ↗');link.href=href;link.target='_blank';link.rel='noopener noreferrer';box.append(link);});
}
function candidateRows(box,rows,choose){
  box.replaceChildren();rows.forEach(x=>{
    const b=button('metadata-suggest-row','',()=>choose(x));
    if(x.artworkUrl){const img=node('img','suggest-cover');img.alt='曲库专辑封面';img.loading='lazy';img.src=artworkPreview(x.artworkUrl);b.append(img);}
    b.append(node('span','',`${x.title} — ${x.artist}${x.album?' · '+x.album:''}（${x.source||'曲目资料'}）`));box.append(b);
  });
}
function applyBiliProposal(x){biliProposal=x;$('bili-import-title').value=x.title||'';$('bili-import-artist').value=x.artist||'';}
async function recognizeBili(item){
  const seq=++biliRecognitionSequence,url=$('bili-import-url').value.trim();
  const initialTitle=$('bili-import-title').value,initialArtist=$('bili-import-artist').value;
  biliProposal=null;$('bili-recognition-candidates').replaceChildren();$('bili-recognition-status').textContent='正在读取视频资料并联网匹配歌名、歌手与专辑封面…';
  showRecognitionSources([]);
  try{
    const r=await post('/api/metadata/recognize',{url,videoTitle:item?.title||initialTitle});
    if(seq!==biliRecognitionSequence || $('bili-import-url').value.trim()!==url)return;
    if($('bili-import-title').value===initialTitle && $('bili-import-artist').value===initialArtist)applyBiliProposal(r.proposal);
    $('bili-recognition-status').textContent=`${r.confidence==='high'?'匹配较明确':'候选待确认'} · ${r.proposal.source}。${r.warning||'已自动填写，请核对后再转换。'}${r.proposal.artworkUrl?' 已找到专辑封面，转换保存时一并写入。':''}`;
    if(r.reasons?.length)$('bili-recognition-status').textContent+=' 依据：'+r.reasons.join('；')+'。';
    showRecognitionSources(r.sources);
    candidateRows($('bili-recognition-candidates'),r.suggestions,x=>{applyBiliProposal(x);$('bili-recognition-status').textContent='已选择候选信息与封面。请确认实际演唱版本，可继续修改歌名和歌手。';});
  }catch(e){if(seq===biliRecognitionSequence)$('bili-recognition-status').textContent='识别失败，可手动填写后继续：'+e.message;}
}
function prepareBili(item){$('bili-import-url').value=item.pageUrl||'';$('bili-import-title').value=cleanVideoTitle(item.title);$('bili-import-artist').value='';$('bili-import-url').scrollIntoView({behavior:'smooth',block:'center'});recognizeBili(item);}
function toast(txt){const t=$('toast');t.textContent=txt;t.classList.add('show');clearTimeout(toast.timeout);toast.timeout=setTimeout(()=>t.classList.remove('show'),3600);}
async function api(url,options={}){let r;try{r=await fetch(url,options);}catch{throw new Error('无法连接本地服务，请检查程序是否还在运行');}let obj;try{obj=await r.json();}catch{throw new Error('服务器响应异常');}if(!r.ok)throw new Error(obj.error || `请求失败 (${r.status})`);return obj;}
const post=(url,data)=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
function view(name){
  for(const v of ['search','library','account','settings','tasks'])$(v+'-view').classList.toggle('hidden',name!==v);
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  $('breadcrumbs-current').textContent={search:'发现音乐',library:'我的音乐库',account:'网易云同步',settings:'设置和音源配置',tasks:'任务中心'}[name];
  window.scrollTo({top:0,behavior:'smooth'});
  if(name==='library')loadLibrary();if(name==='account')renderAccount();if(name==='tasks')loadIngestionTasks();
}
function notice(msg){$('results-message').hidden=!msg;$('results-message').textContent=msg;}
function emptyMessage(title,sub){const w=node('div','empty-state');w.append(node('div','empty-icon','♫'),node('h3','',title),node('p','',sub));return w;}
function tag(txt,extra=''){return node('span','tag '+extra,txt);}
function renderResults(){
 const c=$('search-results');c.replaceChildren();$('result-count').textContent=state.results.length;
 const counts={all:state.results.length,usable:state.results.filter(x=>x.downloadable||x.kind==='bilibili').length,audio:state.results.filter(x=>x.downloadable).length,bilibili:state.results.filter(x=>x.kind==='bilibili').length,catalog:state.results.filter(x=>!x.downloadable&&x.kind!=='bilibili').length};
 Object.entries(counts).forEach(([k,v])=>$('filter-count-'+k).textContent=v);$('select-all').disabled=!counts.audio;$('batch-btn').disabled=!counts.audio;
 let rows=state.results.filter(x=>state.filter==='all'||(state.filter==='usable'&&(x.downloadable||x.kind==='bilibili'))||(state.filter==='audio'&&x.downloadable)||(state.filter==='bilibili'&&x.kind==='bilibili')||(state.filter==='catalog'&&!x.downloadable&&x.kind!=='bilibili'));
 const preferred=rows.filter(x=>x.category===discovery.version);if(discovery.version!=='all'){
   if(preferred.length)rows=preferred;else if(discovery.version==='original'){$('recommendation-note').textContent='没有明确原版候选；以下为其他版本或待确认线索';}else rows=[];
 }else $('recommendation-note').textContent='各版本按匹配线索排序；不代表已验证录音';
 if(preferred.length&&discovery.version!=='all')$('recommendation-note').textContent='版本来自标题线索，实际录音请试听确认';
 discovery.visible=rows;$('show-more-results').classList.toggle('hidden',rows.length<=3);$('show-more-results').textContent=discovery.expanded?'收起更多音源':'展开其余 '+Math.max(0,rows.length-3)+' 条音源';
 if(!rows.length){c.append(emptyMessage('暂时没有合适的音源','可切换版本或展开其他来源，粘贴支持的视频链接继续。'));return;}
 (discovery.expanded?rows:rows.slice(0,3)).forEach(item=>{
  const row=node('article','result-row source-row'+(discovery.selected?.id===item.id?' selected':''));const main=node('div','result-main');
  const checkbox=node('input','row-select');checkbox.type='checkbox';checkbox.disabled=!item.downloadable;checkbox.checked=state.selected.has(item.id);checkbox.setAttribute('aria-label','批量选择 '+item.title);checkbox.addEventListener('change',()=>checkbox.checked?state.selected.add(item.id):state.selected.delete(item.id));
  main.append(node('h3','',item.title),node('div','meta',item.source+' · '+(item.kind==='bilibili'?'发布者：':'演唱者：')+(item.artist||'待确认')));
  const tags=node('div','tags');tags.append(tag(versionNames[item.category]||'版本待确认'),tag(item.availability==='reference'?'仅信息线索':'待检测获取条件'),tag('音质未检测'));if(item.duration)tags.append(tag(item.duration));main.append(tags,node('p','source-reason',(item.reasons||[]).join('；')||'匹配待确认'));
  const details=node('details','source-details');details.append(node('summary','','来源详情'));details.append(node('p','',item.title));if(safeUrl(item.pageUrl)){const a=node('a','','打开原始来源');a.href=safeUrl(item.pageUrl);a.target='_blank';a.rel='noopener noreferrer';details.append(a);}main.append(details);
  const actions=node('div','row-buttons');if(item.kind==='bilibili'||item.downloadable){actions.append(button('small-btn secondary','试听',()=>previewSource(item)),button('small-btn','导入网易云',()=>selectSource(item)));}row.append(checkbox,createCover(safeUrl(item.thumbnailUrl)),main,actions);c.append(row);
 });
}
function pushTask(name,status){const t={name,status,ok:false,error:false};state.queue.unshift(t);state.queue=state.queue.slice(0,12);renderQueue();return t;}
function updateTask(t,status,ok=false,error=false){t.status=status;t.ok=ok;t.error=error;renderQueue();}
function renderQueue(){const container=$('queue-items');container.replaceChildren();$('queue-count').textContent=state.queue.length;if(!state.queue.length){container.append(node('div','queue-empty','暂无传输任务'));return;}state.queue.forEach(q=>{const e=node('div','queue-item');e.append(node('div','queue-item-title',q.name),node('div','queue-item-status'+(q.ok?' ok':q.error?' error':''),q.status));if(q.cancel && !q.ok && !q.error)e.append(button('small-btn secondary','取消',q.cancel));container.append(e);});}
async function downloadItem(item){if(state.busy.has(item.id))return;state.busy.add(item.id);const task=pushTask(item.title,'正在获取音频…');try{const r=await post('/api/download',{id:item.id});updateTask(task,r.duplicate?'✓ 已在本地音乐库':'✓ 已保存到本地',true);toast(r.duplicate?'本地已有相同文件':`已保存：${item.title}`);await loadLibrary(false);}catch(e){updateTask(task,'✕ '+e.message,false,true);toast(e.message);}finally{state.busy.delete(item.id);}}
async function refreshBiliTools(){
  try{
    const tools=await api('/api/bilibili/tools');state.biliTools=tools;
    const txt=tools.ready?'yt-dlp / FFmpeg 已就绪':`需安装 ${[!tools.ytDlp?'yt-dlp':'',!tools.ffmpeg?'FFmpeg':''].filter(Boolean).join('、')}`;
    $('bili-tools-status').textContent=txt;$('bili-tools-detail').textContent=txt;
  }catch(e){$('bili-tools-status').textContent='检测失败';$('bili-tools-detail').textContent=e.message;}
}
async function convertBili(meta={},syncToCloud=false){
  if(syncToCloud&&!state.connected){toast('请先连接网易云账号后再同步');view('account');return;}
  const url=meta.url||$('bili-import-url').value.trim();
  const title=meta.title||$('bili-import-title').value.trim();
  const artist=meta.artist||$('bili-import-artist').value.trim();
  if(!title||!artist){toast('请先填写正确的歌曲名和歌手，不要直接使用UP主作为歌手');$('bili-import-artist').focus();return;}
  const busyKey='bili-convert';if(state.busy.has(busyKey)){toast('已有 B站转换任务，请等待完成');return;}
  state.busy.add(busyKey);
  const task=pushTask(title,'等待下载任务启动…');let id='';
  try{
    const chosen=biliProposal && biliProposal.title===title && biliProposal.artist===artist?biliProposal:{};
    const result=await post('/api/bilibili/mp3',{url,title,artist,album:chosen.album||'',artworkUrl:chosen.artworkUrl||'',syncToCloud});id=result.id;
    task.cancel=async()=>{if(!id)return;try{await post('/api/bilibili/jobs/'+encodeURIComponent(id)+'/cancel',{});task.cancel=null;updateTask(task,'正在取消…');}catch(e){toast('取消失败：'+e.message);}};
    renderQueue();
    for(let count=0;count<800;count++){
      await new Promise(resolve=>setTimeout(resolve,900));
      const job=await api('/api/bilibili/jobs/'+encodeURIComponent(id));
      if(job.stage==='error'||job.stage==='cancelled')throw new Error(job.error||job.message);
      if(job.stage==='done'){
        task.cancel=null;updateTask(task,job.message,true);
        await loadLibrary(false);toast(job.cloudUploaded?(job.likedStatus==='liked'?'已同步并加入我喜欢':'已上传云盘，喜欢尚未确认'):'MP3 已保存到音乐库');return;
      }
      updateTask(task,(job.progress?`${job.progress}% · `:'')+(job.message||'正在处理…'));
    }
    throw new Error('任务查询超时，文件可能仍在下载，请稍后检查音乐库');
  }catch(e){task.cancel=null;updateTask(task,'✕ '+e.message,false,true);toast(e.message);}
  finally{state.busy.delete(busyKey);}
}
async function search(){const q=$('search-input').value.trim();if(q.length<2){toast('请至少输入两个字符');return;}if(state.searching)return;state.searching=true;$('search-btn').disabled=true;$('search-btn').textContent='搜索中…';notice('');$('search-results').replaceChildren(emptyMessage('正在检索音源和B站视频','多个来源可能需要十几秒；视频线索不等于可下载音频。'));
  renderExternalSearches(q);renderBilibiliLinks(q);$('bili-search-status').textContent='正在查找视频…';
  try{const r=await api('/api/search?q='+encodeURIComponent(q));state.results=r.results;state.selected.clear();discovery.expanded=false;renderResults();recognizeTarget(q);rememberSearch(q);const biliCount=r.results.filter(x=>x.kind==='bilibili').length;const biliError=(r.errors||[]).some(x=>x.startsWith('B站'));$('bili-search-status').textContent=biliCount?`找到 ${biliCount} 条视频`:biliError?'接口受限 · 可打开 B站网页':'无视频结果 · 可在 B站继续搜索';if(r.errors?.length)notice('部分检索服务暂不可用：'+r.errors.join('；'));if(!r.results.length)toast('没有直接返回结果，可以使用 B站官方网页搜索');}
  catch(e){state.results=[];renderResults();$('bili-search-status').textContent='接口不可用 · 可打开 B站网页';notice(e.message);}
  finally{state.searching=false;$('search-btn').disabled=false;$('search-btn').textContent='搜索音乐 ↗';}
}
async function syncItem(item){
  if(!state.connected){view('account');toast('先连接网易云音乐账号，即可一键获取并同步');return;}
  if(state.busy.has(item.id))return;
  state.busy.add(item.id);
  const task=pushTask(item.title,'正在获取音频…');
  try{
    const download=await post('/api/download',{id:item.id});
    updateTask(task,'正在上传网易云云盘…');
    const uploaded=await post('/api/cloud/upload',{id:download.entry.id});
    updateTask(task,'✓ '+uploadLabel(uploaded.entry),true);
    await loadLibrary(false);toast(uploadLabel(uploaded.entry)+'：'+item.title);
  }catch(e){updateTask(task,'✕ '+e.message,false,true);toast(e.message);}
  finally{state.busy.delete(item.id);}
}
async function loadLibrary(redraw=true){try{const r=await api('/api/library');state.library=r.tracks;$('side-count').textContent=r.tracks.length;$('library-stats').textContent=`共 ${r.tracks.length} 首音乐`;if(redraw)renderLibrary();}catch(e){toast(e.message);}}
function renderLibrary(){
  const c=$('library-list');c.replaceChildren();
  if(!state.library.length){c.append(emptyMessage('音乐库还是空的','使用音源搜索获取文件，或从左侧导入你已有的音频。'));return;}
  state.library.forEach(item=>{
    const row=node('article','result-row');row.append(createCover('/api/cover/'+encodeURIComponent(item.id)+'?v='+encodeURIComponent(item.coverUpdatedAt||'')));
    const main=node('div','result-main');
    main.append(node('h3','',item.title),node('div','meta',`${item.artist || '待填写歌手'}${item.album?' · '+item.album:''} · ${fmtSize(item.size)}`));
    const tags=node('div','tags');tags.append(tag(item.format),tag(item.cloudStatus==='uploaded'?(item.uploadVerified?'✓ 云盘已核验':'云盘待核验'):'仅在本地',item.uploadVerified?'tag-license':''));
    if(item.cloudStatus==='uploaded')tags.append(tag(likedLabel(item),item.likedStatus==='liked'?'tag-liked':'tag-pending'));
    if(item.metadataNeedsResync)tags.append(tag('本地标签已更新；云盘旧文件未修改','tag-pending'));
    if(item.coverError&&!item.coverExt)main.append(node('div','meta',item.coverError));
    main.append(tags);
    if(item.likeError&&item.cloudStatus==='uploaded')main.append(node('div','meta','加入喜欢待处理：'+item.likeError));
    const actions=node('div','row-buttons');
    actions.append(button('small-btn secondary','▶ 试听',()=>openPlayer({id:item.id,title:item.title,artist:item.artist})));
    actions.append(button('small-btn secondary','✎ 信息 / 封面',()=>openMetadata(item)));
    actions.append(button('small-btn secondary','↓ 下载',()=>{window.location.href='/api/file/'+encodeURIComponent(item.id);}));
    if(item.cloudStatus!=='uploaded')actions.append(button('small-btn','☁ 上传云盘',()=>uploadToCloud(item)));
    else actions.append(button('small-btn',item.likedStatus==='liked'?'♥ 重新核验喜欢':'♥ 重试加入喜欢',()=>retryLike(item)));
    row.append(main,actions);c.append(row);
  });
}
function openMetadata(item){
  state.metadataEditId=item.id;$('meta-suggestions').replaceChildren();
  clearPendingCover();$('meta-cover-file').value='';
  const img='/api/cover/'+encodeURIComponent(item.id)+'?v='+encodeURIComponent(item.coverUpdatedAt||'');
  showCoverPreview(img,item.coverExt?'当前专辑封面，可重新上传或选择曲库封面':'已有 MP3 封面会自动显示；也可以补充专辑封面');
  $('meta-title').value=item.title||'';$('meta-artist').value=item.artist||'';$('meta-album').value=item.album||'';
  $('meta-notice').textContent=item.cloudStatus==='uploaded'?'提示：此歌曲已在云盘中。修改本地标签不会修改已经上传的云盘文件；如需纠正云盘版本，请在网易云客户端使用匹配纠正功能。':'确认信息后保存，再上传到云盘。只有 MP3 文件会写入 ID3 标签；其他格式只更新 CloudTune 库记录。';
  $('meta-save-upload').classList.toggle('hidden',item.cloudStatus==='uploaded');
  $('metadata-modal').classList.remove('hidden');$('meta-title').focus();
  recognizeLibraryMetadata(item);
}
async function recognizeLibraryMetadata(item){
  const snapshot=[$('meta-title').value,$('meta-artist').value,$('meta-album').value];
  const noticeBefore=$('meta-notice').textContent;$('meta-suggestions').textContent='正在联网识别曲目与专辑封面…';
  try{
    const r=await post('/api/metadata/recognize',{title:item.title,artist:item.artist,description:item.artist?'歌手：'+item.artist:'',url:item.source?.startsWith('B站')?item.pageUrl:''});
    if(state.metadataEditId!==item.id)return;
    if(snapshot.every((v,i)=>v===[$('meta-title').value,$('meta-artist').value,$('meta-album').value][i])&&!state.coverFile&&!state.artworkUrl){
      if(r.proposal.artist){$('meta-title').value=r.proposal.title;$('meta-artist').value=r.proposal.artist;$('meta-album').value=r.proposal.album||'';}
      if(r.proposal.artworkUrl&&!item.coverExt){state.artworkUrl=r.proposal.artworkUrl;showCoverPreview(artworkPreview(state.artworkUrl),'已自动匹配曲库封面，点击保存后生效');}
    }
    $('meta-notice').textContent=noticeBefore+' '+(r.warning||'已预填匹配资料，请确认后保存。')+(r.reasons?.length?' 依据：'+r.reasons.join('；'):'');
    candidateRows($('meta-suggestions'),r.suggestions,applyMetadataCandidate);
  }catch(e){if(state.metadataEditId===item.id)$('meta-suggestions').textContent='自动识别失败，可手动填写或重试：'+e.message;}
}
function applyMetadataCandidate(x){
  $('meta-title').value=x.title;$('meta-artist').value=x.artist;$('meta-album').value=x.album||'';
  clearPendingCover();state.artworkUrl=x.artworkUrl||'';
  showCoverPreview(artworkPreview(state.artworkUrl),state.artworkUrl?'已选择曲库封面，保存后生效':'此候选没有专辑封面，可上传图片');
  $('meta-notice').textContent='已应用候选信息，请核对实际演唱版本后保存。';
}
async function suggestMetadata(){
  const q=[$('meta-title').value,$('meta-artist').value].filter(Boolean).join(' ');
  const box=$('meta-suggestions');box.textContent='正在搜索标准曲目信息…';
  try{
    const data=await api('/api/metadata/suggest?q='+encodeURIComponent(q));box.replaceChildren();
    if(!data.suggestions.length){box.textContent='没有找到匹配的曲目，可手动填写。';return;}
    data.suggestions.forEach(x=>{
      const b=button('metadata-suggest-row','',()=>{
        $('meta-title').value=x.title;$('meta-artist').value=x.artist;$('meta-album').value=x.album;
        clearPendingCover();state.artworkUrl=x.artworkUrl||'';
        if(state.artworkUrl)showCoverPreview(artworkPreview(state.artworkUrl),'已选择曲库封面；保存时写入 MP3');
        $('meta-notice').textContent='已应用候选信息。请核对原唱、翻唱和现场版；封面来自所选曲目。';
      });
      if(safeUrl(x.artworkUrl)){const img=node('img','suggest-cover');img.alt='专辑封面';img.src=artworkPreview(x.artworkUrl);b.append(img);}
      b.append(node('span','',`${x.title} — ${x.artist}${x.album?' · '+x.album:''}`));box.append(b);
    });
  }catch(e){box.textContent='搜索失败（可手动填写）：'+e.message;}
}
function showCoverPreview(src,message){
  const target=$('meta-cover-preview');target.replaceChildren();
  if(src){const img=node('img','cover-image');img.src=src;img.alt='待使用的专辑封面';img.onerror=()=>{target.replaceChildren(node('span','','♫'));$('meta-cover-status').textContent='封面加载失败，请重新选择曲库封面或上传本地图片。';};target.append(img);}
  else target.append(node('span','','♫'));
  $('meta-cover-status').textContent=message||'尚未选择封面';
}
function clearPendingCover(){
  state.artworkUrl='';state.coverFile=null;
  if(state.coverObjectUrl){URL.revokeObjectURL(state.coverObjectUrl);state.coverObjectUrl='';}
}
function closeMetadata(){clearPendingCover();state.metadataEditId=null;$('metadata-modal').classList.add('hidden');}

async function saveMetadata(upload=false){
  if(!state.metadataEditId)return;
  const id=state.metadataEditId;
  const data={id,title:$('meta-title').value.trim(),artist:$('meta-artist').value.trim(),album:$('meta-album').value.trim(),artworkUrl:state.artworkUrl};
  const coverUpload=state.coverFile;
  if(!data.title||!data.artist){$('meta-notice').textContent='歌名和歌手都必须填写。';return;}
  const btn=upload?$('meta-save-upload'):$('meta-save');btn.disabled=true;
  try{const r=await post('/api/library/metadata',data);
    let saved=r.entry;
    if(coverUpload){const coverResult=await api('/api/library/cover?id='+encodeURIComponent(id),{method:'POST',headers:{'Content-Type':coverUpload.type},body:coverUpload});saved=coverResult.entry;}
    closeMetadata();await loadLibrary(true);toast('已更新歌曲信息和封面'+(r.alreadyUploaded?'（云盘原有文件未修改）':''));if(upload)await uploadToCloud(saved);}
  catch(e){$('meta-notice').textContent=e.message;}finally{btn.disabled=false;}
}
async function retryLike(item){
  if(!state.connected){view('account');toast('请先连接网易云账号');return;}
  if(state.busy.has(item.id))return;
  state.busy.add(item.id);const t=pushTask(item.title,'正在验证是否加入「我喜欢的音乐」…');
  try{const r=await post('/api/cloud/like',{id:item.id});const ok=r.entry.likedStatus==='liked';updateTask(t,ok?'♥ 已确认加入我喜欢':'需要处理：'+(r.entry.likeError||'网易云未确认'),ok,!ok);await loadLibrary(true);toast(ok?'已加入我喜欢':'未能验证，请查看音乐库状态');}
  catch(e){updateTask(t,'✕ '+e.message,false,true);toast(e.message);}finally{state.busy.delete(item.id);}
}
async function uploadToCloud(item){
  if(item.cloudStatus==='uploaded'){return retryLike(item);}
  if(!item.title||!item.artist){openMetadata(item);toast('请先确认歌名和歌手');return;}
  if(!state.connected){view('account');toast('请先连接网易云账号');return;}
  if(state.busy.has(item.id))return;
  state.busy.add(item.id);const t=pushTask(item.title,'正在上传网易云云盘…');
  try{const r=await post('/api/cloud/upload',{id:item.id});updateTask(t,'✓ '+uploadLabel(r.entry),true);toast(uploadLabel(r.entry)+'：'+item.title);await loadLibrary(true);}
  catch(e){updateTask(t,'✕ '+e.message,false,true);toast('上传失败：'+e.message);}finally{state.busy.delete(item.id);}
}
async function likeExistingTracks(){
  if(!state.connected){view('account');toast('请先登录网易云账号');return;}
  const pending=state.library.filter(x=>x.cloudStatus==='uploaded'&&x.likedStatus!=='liked');
  if(!pending.length){toast('音乐库里没有需要补喜欢的已上传歌曲');return;}
  const buttonEl=$('library-like-pending');buttonEl.disabled=true;
  const t=pushTask(`补喜欢（${pending.length}首）`,'正在处理云盘歌曲…');let success=0;
  try{
    for(let i=0;i<pending.length;i++){
      const item=pending[i];updateTask(t,`正在验证 ${i+1}/${pending.length}：${item.title}`);
      try{const response=await post('/api/cloud/like',{id:item.id});if(response.entry.likedStatus==='liked')success++;}catch{} // keep processing others
    }
    updateTask(t,`完成：${success}/${pending.length} 首已验证加入「我喜欢的音乐」`,success===pending.length,success!==pending.length);
    await loadLibrary(true);toast(`完成：${success}/${pending.length} 首已验证加入我喜欢`);
  }finally{buttonEl.disabled=false;}
}
async function importFiles(files){for(const f of files){if(!/\.(mp3|flac|ogg|oga|wav|m4a|aac)$/i.test(f.name)){toast('不支持的文件：'+f.name);continue;}if(f.size>100*1024*1024){toast('文件超过100MB：'+f.name);continue;}const task=pushTask(f.name,'正在保存本地文件…');try{const r=await api('/api/import?filename='+encodeURIComponent(f.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:f});updateTask(task,r.duplicate?'✓ 已存在':'✓ 导入成功',true);toast('已导入：'+f.name);}catch(e){updateTask(task,'✕ '+e.message,false,true);toast(e.message);}}await loadLibrary(true);view('library');}
async function refreshStatus(){try{const x=await api('/api/status');state.connected=x.connected;state.account=x.account;$('top-dot').classList.toggle('off',!x.connected);$('sync-dot').classList.toggle('off',!x.connected);$('top-cloud-label').textContent=x.connected?(x.account||'已连接'):'尚未连接云盘';$('sync-label').textContent=x.connected?'云盘已连接':'等待连接';$('sync-description').textContent=x.connected?'账号已连接，可前往音乐库上传歌曲。':'连接你的网易云音乐账号，上传音乐后即可在其他设备上收听。';$('sync-connect').textContent=x.connected?'查看云盘 ↗':'连接网易云账号 ↗';$('jamendo-dot').textContent=x.jamendoConfigured?'· 已启用':'· 可选';state.autoLike=x.autoLike;$('auto-like').checked=x.autoLike;renderAccount();}catch(e){toast(e.message);}}
function renderAccount(){$('account-name').textContent=state.connected?'已连接：'+(state.account||'网易云用户'):'尚未连接网易云音乐';$('account-detail').textContent=state.connected?'连接有效，前往音乐库选择需要上传的文件。':'扫码登录后，即可把音乐库中的文件上传到你的私人音乐云盘。';$('account-login').classList.toggle('hidden',state.connected);$('account-logout').classList.toggle('hidden',!state.connected);}
function renderBilibiliLinks(q){
  const root=$('bili-links');root.replaceChildren();
  const variants=[['B站综合搜索',q],['官方 / MV',q+' 官方 MV'],['翻唱版本',q+' 翻唱'],['演唱会 / 现场',q+' 现场']];
  variants.forEach(([label,searchText],i)=>{
    const a=node('a','bili-shortcut'+(i===0?' primary':''),label+' ↗');
    a.href='https://search.bilibili.com/all?keyword='+encodeURIComponent(searchText);
    a.target='_blank';a.rel='noopener noreferrer';root.append(a);
  });
}
function renderExternalSearches(q){
  const box=$('external-searches');box.replaceChildren();
  const links=[
    ['B站视频', 'https://search.bilibili.com/all?keyword='+encodeURIComponent(q)],
    ['Bing 全网','https://www.bing.com/search?q='+encodeURIComponent(q+' 歌曲 免费 下载')],
    ['Bandcamp','https://bandcamp.com/search?q='+encodeURIComponent(q)],
    ['SoundCloud','https://soundcloud.com/search/sounds?q='+encodeURIComponent(q)],
    ['Audius','https://audius.co/search/'+encodeURIComponent(q)],
    ['Free Music Archive','https://freemusicarchive.org/search/?quicksearch='+encodeURIComponent(q)],
    ['Openverse','https://openverse.org/search/audio?q='+encodeURIComponent(q)]
  ];
  links.forEach(([label,url])=>{const a=node('a','external-chip',label+' ↗');a.href=url;a.target='_blank';a.rel='noopener noreferrer';box.append(a);});
}
async function connectSession(){
  const f=$('session-cookie'),msg=$('session-error');msg.textContent='正在验证账号…';
  try{const r=await post('/api/login/session',{cookie:f.value});f.value='';msg.textContent='连接成功';await refreshStatus();toast('已连接：'+r.account);}
  catch(e){msg.textContent=e.message;f.value='';}
}
async function beginQR(){const modal=$('qr-modal');modal.classList.remove('hidden');$('qr-retry').classList.add('hidden');$('qr-box').replaceChildren(node('div','spinner'));$('qr-status').textContent='正在获取二维码…';clearInterval(state.qrTimer);
  try{const res=await post('/api/login/start',{});if(modal.classList.contains('hidden'))return;if(!/^data:image\/(png|jpeg);base64,/.test(res.qrimg||''))throw new Error('二维码数据格式不正确');const img=node('img');img.src=res.qrimg;img.alt='网易云音乐登录二维码';$('qr-box').replaceChildren(img);$('qr-status').textContent='等待扫码';state.qrTimer=setInterval(pollQR,3000);}
  catch(e){$('qr-status').textContent=e.message;$('qr-retry').classList.remove('hidden');$('qr-box').replaceChildren(node('div','','连接失败'));}}
async function pollQR(){if($('qr-modal').classList.contains('hidden'))return;try{const r=await api('/api/login/poll');$('qr-status').textContent=r.message||'等待扫码';if(r.code===803&&!r.connected){clearInterval(state.qrTimer);$('qr-retry').classList.remove('hidden');}if(r.connected){const resume=discovery.returnToImport;closeQR();await refreshStatus();if(resume)openImportDialog();else view('account');toast('网易云音乐连接成功');}else if(r.code===800){clearInterval(state.qrTimer);$('qr-retry').classList.remove('hidden');}}catch(e){$('qr-status').textContent=e.message;}}
function closeQR(){discovery.returnToImport=false;clearInterval(state.qrTimer);state.qrTimer=null;$('qr-modal').classList.add('hidden');}
async function loadCloudList(){const c=$('cloud-list');c.textContent='正在读取云盘…';try{const r=await api('/api/cloud/list');c.replaceChildren();if(!r.songs.length){c.textContent='云盘没有返回歌曲';return;}r.songs.forEach(x=>{const line=node('div','cloud-item',x.name);line.append(node('span','',x.artist));c.append(line);});}catch(e){c.textContent='无法获取列表：'+e.message;}}
function init(){
  document.querySelectorAll('[data-view]').forEach(x=>x.addEventListener('click',()=>view(x.dataset.view)));
  $('top-cloud').addEventListener('click',()=>view('account'));$('sync-connect').addEventListener('click',()=>view('account'));
  document.querySelectorAll('[data-filter]').forEach(x=>x.addEventListener('click',()=>{state.filter=x.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b===x));renderResults();}));
  $('search-btn').addEventListener('click',search);$('search-input').addEventListener('keydown',e=>{if(e.key==='Enter')search();});
  $('bili-import-btn').addEventListener('click',()=>convertBili({},false));
  $('bili-recognize').addEventListener('click',()=>recognizeBili());
  $('bili-import-sync').addEventListener('click',()=>convertBili({},true));
  $('bili-tools-refresh').addEventListener('click',refreshBiliTools);
  $('bili-deps-link').addEventListener('click',e=>{e.preventDefault();view('settings');setTimeout(()=>$('bili-deps').scrollIntoView({behavior:'smooth'}),80);});
  document.querySelectorAll('[data-query]').forEach(x=>x.addEventListener('click',()=>{$('search-input').value=x.dataset.query;search();}));
  $('batch-btn').addEventListener('click',async()=>{const arr=state.results.filter(x=>x.downloadable && state.selected.has(x.id));if(!arr.length){toast('请先勾选歌曲');return;}for(const item of arr)await downloadItem(item);toast('批量任务已结束，请查看传输状态');});
  $('select-all').addEventListener('click',()=>{const choices=state.results.filter(x=>x.downloadable);const all=state.selected.size===choices.length;state.selected=new Set(all?[]:choices.map(x=>x.id));renderResults();$('select-all').textContent=all?'全选':'取消全选';});
  $('library-refresh').addEventListener('click',()=>loadLibrary(true));$('library-like-pending').addEventListener('click',likeExistingTracks);$('cloud-refresh').addEventListener('click',loadCloudList);
  $('choose-file').addEventListener('click',e=>{e.stopPropagation();$('files').click();});$('dropzone').addEventListener('click',()=>{ $('files').click();});
  $('files').addEventListener('change',async e=>{await importFiles(Array.from(e.target.files));e.target.value='';});
  const zone=$('dropzone');for(const event of ['dragover','dragenter'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.add('dragging');});for(const event of ['dragleave','drop'])zone.addEventListener(event,e=>{e.preventDefault();zone.classList.remove('dragging');});zone.addEventListener('drop',e=>importFiles(Array.from(e.dataTransfer.files)));
  $('session-connect').addEventListener('click',connectSession);
  $('account-login').addEventListener('click',beginQR);$('qr-close').addEventListener('click',closeQR);$('qr-modal').addEventListener('click',e=>{if(e.target===$('qr-modal'))closeQR();});$('qr-retry').addEventListener('click',beginQR);
  $('account-logout').addEventListener('click',async()=>{try{await post('/api/logout',{});await refreshStatus();toast('已断开账号连接');}catch(e){toast(e.message);}});
  const saveSettings=async data=>{try{await post('/api/settings',data);await refreshStatus();toast('设置已保存');}catch(e){toast(e.message);}};
  $('save-settings').addEventListener('click',()=>saveSettings({jamendoClientId:$('jamendo-key').value}));
  $('save-like-settings').addEventListener('click',()=>saveSettings({autoLike:$('auto-like').checked}));
  $('metadata-close').addEventListener('click',closeMetadata);
  $('metadata-modal').addEventListener('click',e=>{if(e.target===$('metadata-modal'))closeMetadata();});
  $('meta-suggest').addEventListener('click',suggestMetadata);
  $('meta-cover-file').addEventListener('change',e=>{
    const file=e.target.files?.[0];if(!file)return;
    if(!['image/png','image/jpeg'].includes(file.type)||file.size>2*1024*1024){toast('请上传小于 2MB 的 JPG 或 PNG 图片');e.target.value='';return;}
    clearPendingCover();state.coverFile=file;state.coverObjectUrl=URL.createObjectURL(file);
    showCoverPreview(state.coverObjectUrl,'本地图片已选择，保存后写入 MP3 标签');
  });
  $('meta-cover-clear').addEventListener('click',()=>{
    clearPendingCover();$('meta-cover-file').value='';const item=state.library.find(x=>x.id===state.metadataEditId);
    showCoverPreview(item?'/api/cover/'+encodeURIComponent(item.id):'', '已取消本次封面更换；原文件封面保留');
  });
  $('player-close').addEventListener('click',closePlayer);

  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('import-modal').open&&!$('player-modal').classList.contains('hidden'))closePlayer();});
  $('meta-save').addEventListener('click',()=>saveMetadata(false));
  $('meta-save-upload').addEventListener('click',()=>saveMetadata(true));
  renderQueue();refreshStatus();refreshBiliTools();loadLibrary(false);
}
const discovery={version:'original',expanded:false,visible:[],selected:null,preview:null,proposal:null,target:null,sequence:0,taskLoading:false,submitting:false,returnToImport:false};
function openImportDialog(){
 $('import-error').textContent='';$('import-account').textContent=state.connected?'网易云云盘 · '+(state.account||'当前账号'):'尚未连接网易云账号';$('import-connect').classList.toggle('hidden',state.connected);
 $('import-outcome').textContent='保存到本地音乐库并上传网易云云盘'+(state.autoLike?'，上传后尝试加入「我喜欢的音乐」。':'。');
 if(!$('import-modal').open)$('import-modal').showModal();$('selected-title').focus();
}
function closeImportDialog(){if(discovery.submitting)return;$('import-modal').close();}
const versionNames={original:'原版相关 · 待核实',live:'Live',cover:'翻唱',instrumental:'伴奏',remix:'Remix',unknown:'版本待确认'};
function previewSource(item){openPlayer({...item,url:item.downloadable?'/api/source/listen/':item.url});discovery.preview=item;$('player-modal').classList.toggle('video-player',item.kind==='bilibili');$('player-modal').classList.add('collapsed');$('player-expand').textContent='展开详情';}
function applySelectedMetadata(proposal){discovery.proposal=proposal;$('selected-title').value=proposal.title||'';$('selected-artist').value=proposal.artist||'';$('selected-album').value=proposal.album||'';$('selected-cover').replaceChildren(createCover(artworkPreview(proposal.artworkUrl),'result-cover'));}
async function selectSource(item){
 if(discovery.submitting)return;
 const seq=++discovery.sequence;discovery.selected=item;discovery.proposal=null;$('source-rights').checked=false;$('ingest-selected').disabled=!item.downloadable&&item.kind!=='bilibili';
 $('selected-description').textContent=item.title+' · '+item.source;$('selected-reasons').textContent=(item.reasons||[]).join('；');$('selected-cover').replaceChildren(createCover('','result-cover'),node('p','import-cover-hint','封面待匹配'));$('selection-candidates').replaceChildren();
 $('selected-title').value=cleanVideoTitle(item.title);$('selected-artist').value=item.kind==='bilibili'||item.artist==='未知艺术家'?'':item.artist||'';$('selected-album').value='';renderResults();openImportDialog();
 $('selection-recognition').textContent='正在核对歌曲信息，请勿把视频发布者直接当作演唱者…';
 const initial=[$('selected-title').value,$('selected-artist').value,$('selected-album').value];
 try{
  const result=await post('/api/metadata/recognize',item.kind==='bilibili'?{url:item.pageUrl,videoTitle:item.title}:{title:item.title,artist:item.artist,description:'歌手：'+(item.artist||'')});
  if(seq!==discovery.sequence)return;
  const unchanged=initial.every((v,i)=>v===[$('selected-title').value,$('selected-artist').value,$('selected-album').value][i]);
  if(unchanged && result.confidence==='high')applySelectedMetadata(result.proposal);
  $('selection-recognition').textContent=result.warning||'已匹配资料，入库前可以直接修改。';
  candidateRows($('selection-candidates'),result.suggestions.slice(0,3),x=>{if(discovery.sequence===seq){applySelectedMetadata(x);$('selection-recognition').textContent='已应用候选，请核对实际演唱版本。';}});
 }catch(e){if(seq===discovery.sequence)$('selection-recognition').textContent='资料匹配失败，请手动填写：'+e.message;}
}
async function recognizeTarget(q){
 const query=q;$('target-song').classList.remove('hidden');$('target-description').textContent='正在识别目标歌曲…';$('target-candidates').replaceChildren();
 try{const r=await post('/api/metadata/recognize',/^https?:/.test(q)?{url:q}:{title:q,videoTitle:q});if($('search-input').value.trim()!==query)return;
  discovery.target=r.confidence==='high'?r.proposal:null;
  $('target-description').textContent=r.proposal.title+' · '+(r.proposal.artist||'演唱者待确认')+' · '+(r.warning||'请选择实际对应的录音版本');
  candidateRows($('target-candidates'),r.suggestions.slice(0,3),x=>{discovery.target=x;$('target-description').textContent=x.title+' · '+x.artist+' · '+(x.album||'专辑未提供');$('search-input').value=x.title+' '+x.artist;search();});
 }catch(e){if($('search-input').value.trim()===query)$('target-description').textContent='标准歌曲信息暂不可用，可继续试听和选择音源。';}
}
function rememberSearch(q){try{const previous=JSON.parse(localStorage.getItem('cloudtune-recent')||'[]');localStorage.setItem('cloudtune-recent',JSON.stringify([q,...previous.filter(x=>x!==q)].slice(0,5)));}catch{}renderRecentSearches();}
function renderRecentSearches(){const root=$('recent-searches');root.replaceChildren();try{const entries=JSON.parse(localStorage.getItem('cloudtune-recent')||'[]');entries.forEach(q=>root.append(button('ghost-btn',q,()=>{$('search-input').value=q;search();})));}catch{}}
async function ingestSelected(){
 if(discovery.submitting)return;const fail=message=>{$('import-error').textContent=message;};$('import-error').textContent='';
 const source=discovery.selected;if(!source){fail('请先选择音源');return;}
 if(!state.connected){fail('请先连接网易云账号，已填写的信息会保留');return;}
 if(!source.downloadable&&source.kind!=='bilibili'){fail('这条结果只有信息，不能直接入库');return;}
 if(!$('source-rights').checked){fail('请确认你有权保存和上传这个音源');$('source-rights').focus();return;}
 const title=$('selected-title').value.trim(),artist=$('selected-artist').value.trim(),album=$('selected-album').value.trim();if(!title||!artist||artist==='待确认'){fail('请先填写歌名和实际演唱者');(!title?$('selected-title'):$('selected-artist')).focus();return;}
 const selected=discovery.proposal;const artworkUrl=selected&&selected.title===title&&selected.artist===artist?selected.artworkUrl||'':'';
 discovery.submitting=true;$('ingest-selected').disabled=true;$('ingest-selected').textContent='正在提交…';$('import-close').disabled=$('import-cancel').disabled=true;
 try{await post('/api/ingest',{sourceId:source.id,url:source.kind==='bilibili'?source.pageUrl:undefined,metadata:{title,artist,album,artworkUrl},confirmedRights:true});$('import-modal').close();toast('导入任务已开始，右侧可查看进度');await loadIngestionTasks();}
 catch(e){fail('未能启动任务：'+e.message);}finally{discovery.submitting=false;$('ingest-selected').disabled=!discovery.selected;$('ingest-selected').textContent='确认导入';$('import-close').disabled=$('import-cancel').disabled=false;}
}
async function loadIngestionTasks(){
 if(discovery.taskLoading)return;discovery.taskLoading=true;
 try{
  const r=await api('/api/tasks');const box=$('task-list');box.replaceChildren();
  $('nav-task-count').textContent=r.tasks.filter(t=>['queued','running'].includes(t.status)).length;
  if(!r.tasks.length)box.append(emptyMessage('还没有入库任务','选择音源后点击一键入库，处理阶段与恢复操作会保存在这里。'));
  for(const task of r.tasks){
   const row=node('article','task-row');row.append(node('h3','',task.metadata.title+' · '+task.metadata.artist),node('p','',({queued:'等待处理',running:'正在处理',done:'全部完成',partial:'部分完成',failed:'处理失败',interrupted:'待恢复',cancelled:'已取消'})[task.status]+' · '+task.message));
   if(task.error)row.append(node('p','task-error',task.error));
   if(task.entryId)row.append(node('p','meta','本地文件已保存 · '+(task.uploadVerified?'云盘已核验':'云盘尚未核验')+' · '+(task.likedStatus==='liked'?'喜欢已核验':'喜欢未核验')));
   const details=node('details','source-details');details.append(node('summary','','处理记录'));for(const log of task.logs||[])details.append(node('p','',log.time+' · '+log.message));row.append(details);
   if(['failed','partial','interrupted','cancelled'].includes(task.status))row.append(button('outline-btn',task.entryId?'从已保存文件重试':'重新尝试',async()=>{try{await post('/api/tasks/'+task.id+'/retry',{});await loadIngestionTasks();}catch(e){toast(e.message);}}));
   if(['queued','running'].includes(task.status))row.append(button('outline-btn','取消任务',async()=>{try{await post('/api/tasks/'+task.id+'/cancel',{});}catch(e){toast(e.message);}}));
   box.append(row);
  }
  const running=r.tasks.filter(t=>['queued','running'].includes(t.status));
  if(running.length){const queue=$('queue-items');queue.replaceChildren();for(const t of running){const row=node('div','queue-item');row.append(node('div','queue-item-title',t.metadata.title),node('div','queue-item-status',t.message));queue.append(row);}$('queue-count').textContent=running.length;}
  else if(r.tasks.length){const latest=r.tasks[0];const queue=$('queue-items');queue.replaceChildren();const row=node('div','queue-item');row.append(node('div','queue-item-title',latest.metadata.title),node('div','queue-item-status'+(latest.status==='failed'?' error':''),latest.error||latest.message));row.append(button('small-btn secondary','查看任务与重试',()=>view('tasks')));queue.append(row);$('queue-count').textContent='0';}
  else if(discovery.hadRunningTasks)renderQueue();
  discovery.hadRunningTasks=running.length>0;
  const signature=JSON.stringify(r.tasks.map(t=>[t.id,t.status,t.entryId,t.uploadVerified,t.likedStatus]));
  if(signature!==discovery.taskSignature){discovery.taskSignature=signature;if(r.tasks.some(t=>t.entryId))loadLibrary(false);}
 }catch(e){$('task-list').textContent='任务记录暂不可用：'+e.message;}finally{discovery.taskLoading=false;}
}
function initDiscovery(){
 $('show-more-results').addEventListener('click',()=>{discovery.expanded=!discovery.expanded;renderResults();});
 document.querySelectorAll('[data-version]').forEach(b=>b.addEventListener('click',()=>{discovery.version=b.dataset.version;discovery.expanded=false;document.querySelectorAll('[data-version]').forEach(x=>x.classList.toggle('active',x===b));renderResults();}));
 $('ingest-selected').addEventListener('click',ingestSelected);
 $('import-close').addEventListener('click',closeImportDialog);$('import-cancel').addEventListener('click',closeImportDialog);
 $('import-modal').addEventListener('cancel',e=>{if(discovery.submitting)e.preventDefault();});
 $('import-modal').addEventListener('close',()=>{discovery.sequence++;});
 $('import-connect').addEventListener('click',()=>{discovery.returnToImport=true;closeImportDialog();beginQR();});
 $('player-select-source').addEventListener('click',()=>discovery.preview?selectSource(discovery.preview):toast('此播放器正在播放本地文件，请在发现页选择音源'));
 for(const [id,direction] of [['player-previous',-1],['player-next',1]])$(id).addEventListener('click',()=>{const choices=discovery.visible.filter(x=>x.kind==='bilibili');if(!choices.length)return;const at=choices.findIndex(x=>x.id===discovery.preview?.id);previewSource(choices[(at+direction+choices.length)%choices.length]);});
 $('player-expand').addEventListener('click',()=>{const collapsed=$('player-modal').classList.toggle('collapsed');$('player-expand').textContent=collapsed?'展开详情':'收起详情';document.body.style.paddingBottom=collapsed?'290px':'430px';});
 renderRecentSearches();loadIngestionTasks();setInterval(loadIngestionTasks,2500);
}
document.addEventListener('DOMContentLoaded',()=>{init();initDiscovery();});

