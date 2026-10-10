'use strict';
const {cleanText,searchMetadataCandidates}=require('./sources');
const {titleFromVideo}=require('./mp3-tags');
const {normalizeForMatch,validateArtworkUrl}=require('./cover-art');
const {normalizeBiliUrl}=require('./bilibili-mp3');
const {simplify}=require('./music-text');
function artwork(value){try{return validateArtworkUrl(String(value||'').replace(/^http:/,'https:'));}catch{return '';}}
async function searchMusicMetadata(query,sdk){
 const calls=[searchMetadataCandidates(query)];
 if(sdk?.cloudsearch)calls.push((async()=>{
  let timer;try{
   const r=await Promise.race([sdk.cloudsearch({keywords:query,type:1,limit:20}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('网易云资料查询超时')),12000);})]);
   if(r?.body?.code!==200)throw new Error('网易云曲目资料暂不可用');
   return (r.body.result?.songs||[]).map(s=>({title:cleanText(s.name,100),artist:cleanText((s.ar||s.artists||[]).map(a=>a.name).join(' / '),80),album:cleanText((s.al||s.album)?.name,100),artworkUrl:artwork((s.al||s.album)?.picUrl),source:'网易云音乐目录',pageUrl:'https://music.163.com/#/song?id='+encodeURIComponent(s.id)})).filter(s=>s.title&&s.artist);
  }finally{clearTimeout(timer);}
 })());
 const results=await Promise.allSettled(calls);let rows=[];
 for(const result of results)if(result.status==='fulfilled')rows.push(...result.value);
 if(results.every(r=>r.status==='rejected'))throw new Error('曲目资料查询失败，请检查网络后重试');
 const seen=new Set();return rows.filter(row=>{const key=[row.title,row.artist,row.album,row.artworkUrl].join('|');if(seen.has(key))return false;seen.add(key);return true;}).slice(0,32);
}
async function videoEvidence(url,fetchImpl=fetch){
 const normalized=normalizeBiliUrl(url),u=new URL(normalized);const id=u.pathname.split('/').filter(Boolean).at(-1);
 const query=new URLSearchParams(id.startsWith('BV')?{bvid:id}:{aid:id.slice(2)});
 const response=await fetchImpl('https://api.bilibili.com/x/web-interface/view?'+query,{signal:AbortSignal.timeout(8000),headers:{'User-Agent':'Mozilla/5.0','Referer':'https://www.bilibili.com/'}});
 if(!response.ok)throw new Error('视频资料读取失败');const data=await response.json();
 if(data.code!==0 || !data.data)throw new Error('视频资料暂不可用');
 return {videoTitle:cleanText(data.data.title,300),description:cleanText(data.data.desc,1800),uploader:cleanText(data.data.owner?.name,100),videoUrl:normalized};
}
function cleanCredits(value){
 const text=simplify(value).replace(/(?:\b(?:hi[ -]?res|[48]k|hd|hq)\b|无损|音质|高音质|顶级修复|官方\s*mv|歌词版|完整版|画质).*$/i,'').replace(/(?:演唱|翻唱|主唱|歌手)\s*[:：]?/g,'').replace(/\s*[-—–:：]\s*$/,'').trim();
 if(!text||/推荐|分享|作词|作曲|编曲|原唱|合集|翻自|歌曲名|现场版|演唱会|音乐无限/.test(text))return '';
 return text.split(/\s*(?:\/|、|&|，|,|和|与)\s*|\s+/).filter(x=>/^[\p{L}\p{N}·.]{1,30}$/u.test(x)).join(' / ');
}
function creditRoles(description){
 const performers=[],originals=[],contributors=[];
 const pattern=/(演唱者|演唱歌手|演唱|翻唱者|翻唱|主唱|歌手|原唱|作词|作曲|编曲)\s*[:：]\s*([^;；,，。\n]{1,120})/g;
 for(const match of simplify(description).matchAll(pattern)){
   const chunk=match[2].split(/\s*(?:歌曲名|演唱者|演唱|翻唱|歌手|原唱|作词|作曲|编曲)\s*[:：]/)[0];
   const names=cleanCredits(chunk).split(' / ').filter(Boolean);
   (match[1]==='原唱'?originals:/作词|作曲|编曲/.test(match[1])?contributors:performers).push(...names);
 }
 return {performers:[...new Set(performers)],originals:[...new Set(originals)],contributors:[...new Set(contributors)]};
}
async function recognizeMetadata(input,search){
 const raw=cleanText(simplify(input.videoTitle||input.title),300),description=cleanText(simplify(input.description),1800);
 const title=titleFromVideo(raw).replace(/\s*[（(](?:翻唱|cover|live|现场)[^）)]*[）)]/gi,'').trim();
 const evidence=normalizeForMatch(raw+' '+description);const variant=/翻唱|翻自|cover|现场|live|演奏|伴奏/i.test(raw+' '+description);
 // Explicit credits around a quoted song are evidence, unlike the uploader name.
 const quoted=raw.match(/[《“「][^》”」]+[》”」]\s*[-—–:：]\s*([^【\[(（，。!！?？]{1,60})/);
 const prefix=!quoted&&raw.match(/^([^【\[(（《“「]{1,40})\s*[《“「]/);
 const roles=creditRoles(description);
 const explicitArtists=roles.performers.length?roles.performers.join(' / '):cleanCredits(quoted?.[1]||prefix?.[1]||'')||(!variant?roles.originals.join(' / '):'');
 let rows=[],warning='';try{
  rows=await search(title);
  const hints=explicitArtists||cleanText(input.artist,80);
  if(hints){const more=await search(title+' '+hints.replace(/\s*\/\s*/g,' ')).catch(()=>[]);rows=[...rows,...more];}
 }catch(e){warning=e.message;}
 rows=rows.map(row=>({...row,title:simplify(row.title),artist:simplify(row.artist),album:simplify(row.album)}));
 rows=[...new Map(rows.map(row=>[[row.title,row.artist,row.album,row.artworkUrl].join('|'),row])).values()];
 const ranked=rows.map(row=>{
  const artists=row.artist.split(/\s*(?:\/|、|&|，|,)\s*/).filter(Boolean);
  const supported=artists.length>0&&artists.every(a=>{
    const key=normalizeForMatch(a);
    if(roles.performers.length)return roles.performers.some(p=>normalizeForMatch(p)===key);
    if(roles.contributors.some(p=>normalizeForMatch(p)===key)&&!normalizeForMatch(raw).includes(key))return false;
    return evidence.includes(key);
  });
  const exact=normalizeForMatch(row.title)===normalizeForMatch(title) || (!!input.videoTitle&&supported&&normalizeForMatch(row.title).length>=2&&normalizeForMatch(raw).includes(normalizeForMatch(row.title)));
  const variantMatch=!variant || /翻唱|翻自|cover|现场|live|演奏|伴奏/i.test(row.title+' '+row.album);
  return {...row,score:(exact?60:0)+(supported?30:0)+(row.artworkUrl?2:0)-(variant&&!variantMatch?35:0),exact,supported,variantMatch};
 }).sort((a,b)=>b.score-a.score);
 const best=ranked[0];const differentArtists=new Set(ranked.filter(x=>x.exact).map(x=>normalizeForMatch(x.artist))).size;
 const usable=best?.exact && (!explicitArtists||best.supported) && (best.supported||differentArtists<=1) && (!variant || (best.supported&&best.variantMatch));
 const confidence=usable?(best.supported?'high':'medium'):'low';
 if(variant&&!usable)warning='视频可能是翻唱、现场或演奏版本，未找到同一版本的可靠资料；请确认实际演唱者。';
 else if(!usable&&!warning)warning=explicitArtists?'已从视频标题提取演唱者，但曲库未找到同一演唱版本；未自动套用其他歌手的专辑封面，请核对。':'存在多个演唱者或未找到足够匹配的曲目，歌手请从候选中选择或手动补充。';
 else if(confidence==='medium')warning='歌名匹配，但视频资料未明确佐证歌手，当前是待确认候选。';
 const reasons=[explicitArtists?'视频演唱者线索：'+explicitArtists:'视频中暂未找到明确演唱者'];
 if(usable)reasons.push('联网曲库匹配：'+best.title+' — '+best.artist+(best.album?' · '+best.album:''));
 const sources=[...(input.videoUrl?[{title:'B站视频资料',url:input.videoUrl}]:[]),...(usable&&best.pageUrl?[{title:best.source,url:best.pageUrl}]:[])];
 return {proposal:usable?{title:best.title,artist:best.artist,album:best.album||'',artworkUrl:best.artworkUrl||'',source:best.source}:{title,artist:variant?'':explicitArtists,album:'',artworkUrl:'',source:'视频标题（待确认）'},confidence,warning,suggestions:ranked.slice(0,12),reasons,sources,evidence:{videoTitle:raw,description:description.slice(0,400),performers:roles.performers,originals:roles.originals}};
}
module.exports={searchMusicMetadata,videoEvidence,recognizeMetadata};
