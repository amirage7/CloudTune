'use strict';
const { randomUUID } = require('node:crypto');
const AUDIO_EXT = /\.(mp3|flac|ogg|oga|wav|m4a|aac)$/i;
const MAX_AUDIO_SIZE = 100 * 1024 * 1024;
const SOURCE_HOSTS = new Set(['upload.wikimedia.org', 'archive.org', 'cdn.freesound.org', 'files.freemusicarchive.org', 'freemusicarchive.org', 'www.freemusicarchive.org', 'ccmixter.org', 'www.ccmixter.org', 'dig.ccmixter.org']);
const MATCHABLE_LICENSE = /creativecommons\.org\/licenses\/(by|by-sa|by-nd|by-nc|by-nc-sa|by-nc-nd)\/|creativecommons\.org\/publicdomain\/|publicdomain|cc0|^cc[- ]?(by|by-sa|by-nc)/i;

function isApprovedSource(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (SOURCE_HOSTS.has(u.hostname) || (u.hostname.endsWith('.archive.org') && u.hostname.length > '.archive.org'.length) || (u.hostname.endsWith('.jamendo.com') && u.hostname.length > '.jamendo.com'.length));
  } catch { return false; }
}
function cleanText(value, max=180) { return String(value ?? '').replace(/<[^>]*>/g,' ').replace(/\s+/g, ' ').trim().slice(0,max); }
function resultsShape(data) {
  const ext = (data.url ? new URL(data.url).pathname.match(AUDIO_EXT)?.[1] : null) || data.format || '未知';
  const downloadable = data.downloadable !== false && !!data.url && isApprovedSource(data.url);
  return { kind:data.kind || (downloadable?'audio':'catalog'), version:cleanText(data.version || '',60), duration:cleanText(data.duration || '',32), bvid:data.bvid || '', id: randomUUID(), title: cleanText(data.title), artist: cleanText(data.artist || '未知艺术家'), source:data.source, format:String(ext).toUpperCase(), license:cleanText(data.license || '请核对来源许可'), licenseUrl:data.licenseUrl || '', size:Number(data.size || 0), pageUrl:data.pageUrl || '', url:data.url || '', thumbnailUrl:data.thumbnailUrl||'',downloadable }; 
}
function asAudioFile(f) {
  return f && AUDIO_EXT.test(f.name || '') && Number(f.size) > 0 && Number(f.size) <= MAX_AUDIO_SIZE && !f.private;
}
async function fetchJson(url, ms=11500) {
  const response = await fetch(url, {signal:AbortSignal.timeout(ms), headers:{'User-Agent':'CloudTune/0.1 (personal music organizer; local)' } });
  if (!response.ok) throw new Error(`远程服务 HTTP ${response.status}`);
  return response.json();
}
async function searchCommons(query) {
  const url = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ action:'query', generator:'search', gsrsearch:query+' filetype:audio', gsrnamespace:'6', gsrlimit:'40', prop:'imageinfo', iiprop:'url|size|mime|extmetadata', format:'json' }).forEach(([key,value])=>url.searchParams.set(key,value));
  const json = await fetchJson(url.toString());
  const pages = Object.values(json.query?.pages || {});
  return pages.map(p=> {
    const info = p.imageinfo?.[0];
    const link = info?.url;
    const file = p.title?.replace(/^File:/i,'') || '';
    if (!link || !AUDIO_EXT.test(file) || !(info.mime?.startsWith('audio/') || ['application/ogg','application/x-flac'].includes(info.mime)) || info.size > MAX_AUDIO_SIZE || !isApprovedSource(link)) return null;
    const license = info.extmetadata?.LicenseShortName?.value || '';
    const licenseUrl = info.extmetadata?.LicenseUrl?.value || '';
    // Commons hosts files that are free to share, but attribution and other conditions still apply.
    return resultsShape({title:file.replace(AUDIO_EXT,''),source:'Wikimedia Commons',artist:info.extmetadata?.Artist?.value || 'Wikimedia 贡献者',url:link,size:info.size,license,licenseUrl,pageUrl:info.descriptionurl });
  }).filter(Boolean).slice(0,18);
}
async function searchArchive(query) {
  const url = new URL('https://archive.org/advancedsearch.php');
  // Exact user query as phrase reduces irrelevant hits; download is restricted by license check.
  url.searchParams.set('q',`mediatype:audio AND (title:("${query.replace(/["\\]/g,' ').slice(0,90)}") OR creator:("${query.replace(/["\\]/g,' ').slice(0,90)}"))`);
  ['identifier','title','creator','licenseurl','downloads'].forEach(x=>url.searchParams.append('fl[]',x));
  url.searchParams.set('rows','12'); url.searchParams.set('page','1'); url.searchParams.set('output','json');
  const response = await fetchJson(url.toString());
  const docs = (response.response?.docs || []).slice(0,8);
  const output = [];
  // One metadata request at a time to avoid overwhelming archive.org.
  for (const doc of docs) {
    try {
      const licenseVal = cleanText(doc.licenseurl || '',300);
      if (!MATCHABLE_LICENSE.test(licenseVal)) continue;
      const detail = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`,8000);
      const metadataLicense = cleanText(detail.metadata?.licenseurl || licenseVal,300);
      if (!MATCHABLE_LICENSE.test(metadataLicense)) continue;
      const choices = (detail.files || []).filter(asAudioFile).sort((a,b)=> {
        const rank = x=> x.name.toLowerCase().endsWith('.flac') ? 4 : x.name.toLowerCase().endsWith('.mp3') ? 3 : 1;
        return rank(b)-rank(a) || Number(b.size)-Number(a.size);
      }).slice(0,2);
      for (const f of choices) {
        const path = f.name.split('/').map(encodeURIComponent).join('/');
        const fileUrl = `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${path}`;
        if(!isApprovedSource(fileUrl)) continue;
        output.push(resultsShape({title:cleanText(f.title || doc.title || f.name.replace(AUDIO_EXT,'')),artist:doc.creator,source:'Internet Archive',url:fileUrl,size:Number(f.size),pageUrl:`https://archive.org/details/${encodeURIComponent(doc.identifier)}`,license: metadataLicense.split('/').filter(Boolean).slice(-2).join(' / ') || 'Creative Commons',licenseUrl:metadataLicense}));
      }
    } catch (_) { /* skip unavailable metadata; other sources continue */ }
  }
  return output.slice(0,12);
}
async function searchJamendo(query, clientId) {
  if (!clientId) return [];
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  Object.entries({client_id:clientId,format:'json',limit:'25',search:query,audioformat:'mp32'}).forEach(([k,v])=>url.searchParams.set(k,v));
  const res=await fetchJson(url.toString());
  if (res.headers?.status === 'failed') throw new Error(res.headers?.error_message || 'Jamendo API 错误');
  return (res.results || []).filter(s=>s.audiodownload_allowed && s.audiodownload && isApprovedSource(s.audiodownload)).map(s=>resultsShape({title:s.name,artist:s.artist_name,source:'Jamendo',url:s.audiodownload,format:'mp3',size:0,license:s.license_ccurl ? 'CC 许可（详情见来源）':'下载许可见来源',licenseUrl:s.license_ccurl, pageUrl:s.shareurl}));
}
// Openverse aggregates Creative-Commons and public-domain sources. Download
// links are permitted ONLY for known HTTPS hosts; all other hits are discovery.
async function searchOpenverse(query) {
  const url = new URL('https://api.openverse.org/v1/audio/');
  url.searchParams.set('q',query);url.searchParams.set('page_size','25');url.searchParams.set('filter_dead','true');
  const data=await fetchJson(url.toString(),14500);
  return (data.results || []).filter(x=>x.url && /^https:\/\//.test(x.url) && /^https:\/\//.test(x.foreign_landing_url || x.url)).slice(0,25).map(x=>{
    const declaredExt=String(x.filetype || x.url.split('?')[0].split('.').at(-1) || '').toLowerCase();
    const ext=AUDIO_EXT.test('.'+declaredExt)?declaredExt:'未知';
    const approved=ext!=='未知' && isApprovedSource(x.url) && (!x.filesize || x.filesize<=MAX_AUDIO_SIZE);
    return resultsShape({title:x.title,artist:x.creator,source:'Openverse · '+cleanText(x.source || '开放音频',36),
      url:approved?x.url:'',downloadable:approved,format:ext,
      size:x.filesize,license:cleanText((x.license || '').toUpperCase()+' '+(x.license_version || ''),60),
      licenseUrl:x.license_url,pageUrl:x.foreign_landing_url||x.url});
  });
}

// Apple catalog is music METADATA ONLY. Its previewUrl is never downloaded.
async function searchCatalog(query) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term',query);url.searchParams.set('media','music');url.searchParams.set('entity','song');url.searchParams.set('limit','25');
  const data=await fetchJson(url.toString(),12500);
  return (data.results || []).filter(x=>x.trackName && x.trackViewUrl && x.artistName).slice(0,25).map(x=>resultsShape({
    title:x.trackName,artist:x.artistName,source:'Apple 音乐目录（仅信息）',format:'目录',downloadable:false,
    license:'仅歌曲资料，不提供免费音频',pageUrl:x.trackViewUrl
  }));
}

async function searchMetadataCandidates(query,fetchImpl=fetchJson){
  const url=new URL('https://itunes.apple.com/search');
  Object.entries({term:query,media:'music',entity:'song',limit:'12',country:'CN'}).forEach(([k,v])=>url.searchParams.set(k,v));
  const {simplify}=require('./music-text');let results=[],lastError;
  for(const country of ['CN','HK','TW']){
    url.searchParams.set('country',country);
    try{const response=await fetchImpl(url.toString(),7000);results=response.results||[];if(results.some(x=>x.trackName&&x.artistName))break;}catch(e){lastError=e;}
  }
  if(!results.length&&lastError)throw lastError;
  return results.filter(x=>x.trackName&&x.artistName).slice(0,12).map(x=>({
    title:cleanText(simplify(x.trackName),100),artist:cleanText(simplify(x.artistName),80),album:cleanText(simplify(x.collectionName||''),100),artworkUrl:String(x.artworkUrl100||'').replace(/\d+x\d+bb(?=\.)/,'600x600bb'),source:'Apple 音乐目录（仅用于核对信息）',...(x.trackViewUrl?{pageUrl:x.trackViewUrl}:{})
  }));
}
async function searchAll(query, clientId, adapters={ commons:searchCommons, archive:searchArchive, jamendo:searchJamendo, openverse:searchOpenverse, catalog:searchCatalog, bilibili:(query)=>require('./bilibili').searchBilibili(query) }) {
  const tasks=[['Wikimedia Commons',adapters.commons(query)],['Internet Archive',adapters.archive(query)]];
  if(clientId && adapters.jamendo) tasks.push(['Jamendo',adapters.jamendo(query,clientId)]);
  if(adapters.openverse) tasks.push(['Openverse',adapters.openverse(query)]);
  if(adapters.catalog) tasks.push(['Apple 音乐目录',adapters.catalog(query)]);
  if(adapters.bilibili) tasks.push(['B站视频搜索',adapters.bilibili(query)]);
  const results=await Promise.allSettled(tasks.map(([,promise])=>promise));
  const errors=[];
  const hits=[];
  results.forEach((r,i)=>{ if(r.status==='fulfilled') hits.push(...r.value); else errors.push(`${tasks[i][0]}：${r.reason?.message || '搜索失败'}`); });
  const seen=new Set();
  const unique=hits.filter(h=>{const key=[h.source,h.title,h.artist,h.url||h.pageUrl].join('|').toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
  unique.sort((a,b)=>Number(b.downloadable)-Number(a.downloadable) || Number(b.kind==='bilibili')-Number(a.kind==='bilibili'));
  return {hits:unique, errors};
}
module.exports={MAX_AUDIO_SIZE,AUDIO_EXT,isApprovedSource,cleanText,asAudioFile,searchAll,searchOpenverse,searchCatalog,searchMetadataCandidates,resultsShape,MATCHABLE_LICENSE};
