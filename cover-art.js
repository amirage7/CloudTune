'use strict';
/** Album-art validation and bounded retrieval from Apple's iTunes artwork CDN. */
const MAX_COVER_SIZE=2*1024*1024;
const {simplify}=require('./music-text');
function detectImage(bytes){
  if(bytes.length>=8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:'image/png',ext:'png'};
  if(bytes.length>=4 && bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff)return {mime:'image/jpeg',ext:'jpg'};
  throw Object.assign(new Error('仅支持 JPG / PNG 格式的封面图片'),{status:400});
}
function validateArtworkUrl(value){
  let url;
  try{url=new URL(value);}catch{throw Object.assign(new Error('封面来源地址无效'),{status:400});}
  // Exact music catalog CDN allowlist; never fetch arbitrary user-supplied hosts.
  if(url.protocol!=='https:' || url.username || url.password || url.port || !(/^(?:is\d+(?:-ssl)?\.mzstatic\.com|p\d+\.music\.126\.net)$/.test(url.hostname)))throw Object.assign(new Error('只能从 Apple 或网易云曲库取得专辑封面，或上传本地图片'),{status:400});
  return url.toString();
}
async function fetchArtwork(value,fetchImpl=fetch){
  const url=validateArtworkUrl(value);
  const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Mozilla/5.0','Referer':url.includes('.music.126.net/')?'https://music.163.com/':'https://music.apple.com/'}});
  if(!r.ok)throw Object.assign(new Error('专辑封面下载失败（HTTP '+r.status+'）'),{status:502});
  const size=Number(r.headers?.get?.('content-length')||0);
  if(size>MAX_COVER_SIZE)throw Object.assign(new Error('封面图片大于 2MB'),{status:413});
  let chunks=[],len=0;
  for await(const ch of r.body){len+=ch.length;if(len>MAX_COVER_SIZE)throw Object.assign(new Error('封面图片大于 2MB'),{status:413});chunks.push(ch);}
  const b=Buffer.concat(chunks);
  return {bytes:b,...detectImage(b)};
}
function normalizeForMatch(v){return simplify(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'').trim();}
function findExactCandidate(rows,title,artist){
  return (rows||[]).find(x=>x.artworkUrl && normalizeForMatch(x.title)===normalizeForMatch(title) && normalizeForMatch(x.artist)===normalizeForMatch(artist))||null;
}
module.exports={MAX_COVER_SIZE,detectImage,validateArtworkUrl,fetchArtwork,normalizeForMatch,findExactCandidate};
