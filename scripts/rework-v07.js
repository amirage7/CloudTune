'use strict';
const fs=require('node:fs');const path=require('node:path');const root=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(root,'public/index.html'),'utf8');
const first=html.indexOf('      <div class="page-content" id="search-view">'),last=html.indexOf('      <div class="page-content subpage hidden" id="library-view">');
if(first<0||last<first)throw new Error('search section missing');
const prior=html.slice(first,last);const tools=prior.slice(prior.indexOf('<section class="bili-panel"'),prior.indexOf('<section class="external-wrap"'));
const extras=prior.slice(prior.indexOf('<section class="external-wrap"'),prior.indexOf('<section class="section-head"'));
const filters=prior.slice(prior.indexOf('<div class="result-filters"'),prior.indexOf('<div id="search-results"'));
const search=`      <div class="page-content" id="search-view">
 <section class="discovery-heading"><h1>找到你想收藏的那个版本。</h1><p>搜索、试听、选择音源，再一键整理到你的网易云。</p><div class="searchbar"><input id="search-input" type="search" placeholder="歌名、歌手或 B站完整视频链接" autocomplete="off" aria-label="搜索歌曲或音源链接"><button id="search-btn" type="button">搜索音乐</button></div><div id="recent-searches" class="recent-searches"></div></section>
 <section id="target-song" class="target-song hidden" aria-label="目标歌曲"><h2>目标歌曲</h2><p id="target-description">识别结果待确认</p><div id="target-candidates" class="metadata-suggestions"></div></section>
 <div class="section-head"><h2>优先音源 <span class="count" id="result-count">—</span></h2><span id="recommendation-note">最多展示三条，按匹配线索排序</span></div>
 <div id="version-filters" class="result-filters" aria-label="版本筛选"><button class="filter-btn active" data-version="original">原版相关</button><button class="filter-btn" data-version="live">Live</button><button class="filter-btn" data-version="cover">翻唱</button><button class="filter-btn" data-version="instrumental">伴奏</button><button class="filter-btn" data-version="remix">Remix</button><button class="filter-btn" data-version="unknown">待确认</button><button class="filter-btn" data-version="all">全部版本</button></div>
 ${filters}<div id="search-results" class="results"><div class="empty-state"><h3>从一首歌开始</h3><p>搜索后先试听候选，明确选择再入库。不会因为点击试听就下载或上传。</p></div></div>
 <button id="show-more-results" class="outline-btn hidden" type="button">展开更多音源</button>
 <details class="advanced-tools"><summary>其他来源与手动导入</summary>${tools}${extras}<div class="row-actions"><button id="select-all" class="ghost-btn" type="button" disabled>全选可下载音频</button><button id="batch-btn" class="outline-btn" type="button" disabled>保存已选到本地</button></div></details>
 </div>
 <div class="page-content subpage hidden" id="tasks-view"><div class="subpage-head"><h1>任务中心</h1><p>本地保存、云盘核验和喜欢核验分别记录。失败后从已保存的文件继续。</p></div><div id="task-list" class="results"></div></div>
`;
html=html.slice(0,first)+search+html.slice(last);
html=html.replace('音源搜索 <span','发现音乐 <span').replace('云盘连接</button>','网易云同步</button><button type="button" data-view="tasks" class="nav-item">任务中心 <span id="nav-task-count" class="nav-count">0</span></button>');
html=html.replace('LOCAL · V0.6','LOCAL · V0.7');
html=html.replace('<aside class="rightbar">',`<aside class="rightbar"><section class="selection-panel"><h2>选定音源</h2><p id="selected-description">先试听，再选择你想入库的版本。</p><div id="selected-reasons"></div><div class="metadata-fields"><label>歌曲名<input id="selected-title" maxlength="100"></label><label>实际演唱者<input id="selected-artist" maxlength="80"></label><label>专辑<input id="selected-album" maxlength="100"></label></div><div id="selected-cover" class="selected-cover"></div><p id="selection-recognition" role="status"></p><div id="selection-candidates" class="metadata-suggestions"></div><label class="permission-choice"><input id="source-rights" type="checkbox">我确认有权保存和上传这个音源</label><button id="ingest-selected" class="primary-btn" type="button" disabled>一键入库网易云</button><p class="selection-help">自动获取、完善信息与封面、上传云盘并尝试加入喜欢。封面不明确时保留待完善状态。</p></section>`);
html=html.replace('<div class="modal-overlay hidden" id="player-modal" role="dialog" aria-modal="true" aria-labelledby="player-title">','<section class="player-dock hidden" id="player-modal" role="region" aria-label="全局试听播放器">');
html=html.replace('<div class="eyebrow">INLINE PLAYER</div>','<div class="player-actions"><button id="player-previous" class="outline-btn" type="button">上一候选</button><button id="player-next" class="outline-btn" type="button">下一候选</button><button id="player-select-source" class="outline-btn" type="button">选择当前音源</button><button id="player-expand" class="outline-btn" type="button">收起详情</button></div>');
html=html.replace('  <div class="modal-overlay hidden" id="qr-modal"','  <div class="modal-overlay hidden" id="qr-modal"');
// Close only the dock wrapper immediately before the QR modal.
html=html.replace(/  <\/div>\r?\n  <div class="modal-overlay hidden" id="qr-modal"/,'  </section>\n  <div class="modal-overlay hidden" id="qr-modal"');
fs.writeFileSync(path.join(root,'public/index.html'),html);
let app=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const start=app.indexOf('function renderResults(){'),end=app.indexOf('function pushTask(',start);
if(start<0||end<start)throw new Error('render section missing');
app=app.slice(0,start)+`function renderResults(){
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
  const actions=node('div','row-buttons');if(item.kind==='bilibili')actions.append(button('small-btn secondary','试听',()=>previewSource(item)));actions.append(button('small-btn','选择此音源',()=>selectSource(item)));row.append(checkbox,createCover(safeUrl(item.thumbnailUrl)),main,actions);c.append(row);
 });
}
`+app.slice(end);
app=app.replace("for(const v of ['search','library','account','settings'])","for(const v of ['search','library','account','settings','tasks'])");
app=app.replace("{search:'音源搜索',library:'我的音乐库',account:'云盘连接',settings:'设置和音源配置'}","{search:'发现音乐',library:'我的音乐库',account:'网易云同步',settings:'设置和音源配置',tasks:'任务中心'}");
app=app.replace("if(name==='library')loadLibrary();if(name==='account')renderAccount();","if(name==='library')loadLibrary();if(name==='account')renderAccount();if(name==='tasks')loadIngestionTasks();");
app=app.replace('state.results=r.results;state.selected.clear();renderResults();','state.results=r.results;state.selected.clear();discovery.expanded=false;renderResults();recognizeTarget(q);rememberSearch(q);');
app=app.replace("if(q.length<2){", "if(q.length<2){");
app=app.replace("  $('player-modal').addEventListener('click',e=>{if(e.target===$('player-modal'))closePlayer();});",'');
fs.writeFileSync(path.join(root,'public/app.js'),app);
