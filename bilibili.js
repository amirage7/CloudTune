'use strict';
/**
 * Bilibili video DISCOVERY only. Never requests video streams or parses audio tracks.
 * Unofficial search endpoints may require login or be blocked. The UI always offers
 * a user-initiated link to the official search website as a reliable fallback.
 */
const {createHash}=require('node:crypto');
const {cleanText,resultsShape}=require('./sources');
const MIXIN_KEY_ENC_TAB=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const BROWSER_HEADERS={
  'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer':'https://www.bilibili.com/',
  'Accept':'application/json,text/plain,*/*'
};
function bilibiliSearchLink(query,mode='all'){
  const suffix=mode==='cover'?' 翻唱':mode==='live'?' 现场':mode==='official'?' 官方 MV':'';
  return 'https://search.bilibili.com/all?keyword='+encodeURIComponent(String(query).trim()+suffix);
}
function cleanBilibiliTitle(s){return cleanText(String(s || '').replace(/<\/?em(?:\s+[^>]*)?>/gi,''),180);}
function classifyVideo(title){
  const t=String(title).toLowerCase();
  if(/翻唱|cover|自翻|改编|演奏|翻奏/.test(t))return '翻唱 / 演奏';
  if(/现场|live|演唱会|音乐节|巡演/.test(t))return '现场版';
  if(/官方|official|mv|music video|完整版/.test(t))return 'MV / 官方相关';
  if(/伴奏|纯音乐|instrumental|karaoke/.test(t))return '伴奏';
  return '视频';
}
function normalizeThumbnail(raw){
  const rawUrl=String(raw||'').trim();if(!rawUrl)return '';
  try{const u=new URL(rawUrl.startsWith('//')?'https:'+rawUrl:rawUrl);if(u.protocol!=='https:'||!/^i\d+\.hdslb\.com$/.test(u.hostname))return '';return u.toString();}catch{return '';}
}
function parseVideoResults(data){
  const items=Array.isArray(data?.data?.result)?data.data.result:[];
  return items.slice(0,30).flatMap(v=>{
    const bvid=String(v.bvid||'');
    if(!/^BV[0-9A-Za-z]{10}$/.test(bvid))return [];
    const title=cleanBilibiliTitle(v.title);
    if(!title)return [];
    return [resultsShape({title,artist:cleanText(v.author || v.uname || 'B站 UP主',90),source:'B站 · 视频搜索',pageUrl:`https://www.bilibili.com/video/${bvid}/`,format:'视频',license:'是否允许下载音轨需自行核实',downloadable:false,kind:'bilibili',version:classifyVideo(title),duration:v.duration||'',bvid,thumbnailUrl:normalizeThumbnail(v.pic||v.cover)})];
  }).slice(0,20);
}
async function requestJson(url,fetchImpl,timeout=8500,allowAnonymousNav=false){
  const response=await fetchImpl(url,{signal:AbortSignal.timeout(timeout),headers:BROWSER_HEADERS});
  if(!response.ok)throw new Error('B站视频搜索 HTTP '+response.status);
  const data=await response.json();
  if(Number(data.code)!==0 && !(allowAnonymousNav && Number(data.code)===-101 && data?.data?.wbi_img))throw new Error('B站视频搜索返回 '+String(data.code)+'（可能需要网页登录或受到访问限制）');
  return data;
}
function signedSearchParams(query,imgKey,subKey,timestamp){
  if(!/^[a-zA-Z0-9]{32}$/.test(imgKey) || !/^[a-zA-Z0-9]{32}$/.test(subKey))throw new Error('B站接口签名信息无效');
  const base=imgKey+subKey;
  const mix=MIXIN_KEY_ENC_TAB.map(i=>base[i]).join('').slice(0,32);
  const params={keyword:query,page:'1',search_type:'video',wts:String(timestamp)};
  const qs=Object.entries(params).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(String(v).replace(/[!'()*]/g,''))}`).join('&');
  const sig=createHash('md5').update(qs+mix).digest('hex');
  return qs+'&w_rid='+sig;
}
async function searchBilibili(query,fetchImpl=fetch){
  // Prefer a lightweight request. Never use, solicit, or copy the user's Bilibili cookies.
  const simple='https://api.bilibili.com/x/web-interface/search/type?'+new URLSearchParams({search_type:'video',keyword:query,page:'1'});
  try{
    return parseVideoResults(await requestJson(simple,fetchImpl));
  }catch(firstError){
    // One bounded attempt with signed metadata-only endpoint; no stream access.
    try{
      const navResponse=await requestJson('https://api.bilibili.com/x/web-interface/nav',fetchImpl,8500,true);
      const wbi=navResponse.data?.wbi_img;
      const imgKey=new URL(wbi.img_url).pathname.split('/').pop().split('.')[0];
      const subKey=new URL(wbi.sub_url).pathname.split('/').pop().split('.')[0];
      const params=signedSearchParams(query,imgKey,subKey,Math.floor(Date.now()/1000));
      const signed='https://api.bilibili.com/x/web-interface/wbi/search/type?'+params;
      return parseVideoResults(await requestJson(signed,fetchImpl));
    }catch(secondError){
      throw new Error(`${secondError.message}；请使用“B站网页搜索”入口`);
    }
  }
}
module.exports={bilibiliSearchLink,cleanBilibiliTitle,classifyVideo,parseVideoResults,signedSearchParams,searchBilibili,normalizeThumbnail};
