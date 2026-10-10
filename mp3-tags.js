'use strict';
/** Write ID3v2 artist/title/album and optionally APIC image without external packages. */
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {detectImage}=require('./cover-art');
function syncsafe(n){return Buffer.from([(n>>21)&127,(n>>14)&127,(n>>7)&127,n&127]);}
function decodeSyncsafe(b,start){return (b[start]<<21)|(b[start+1]<<14)|(b[start+2]<<7)|b[start+3];}
function titleFromVideo(value){
  let t=String(value||'').normalize('NFKC');
  t=t.replace(/\[(?:hi[ -]?res|无损音质|高音质|音质提升|4k|8k|完整版|歌词版|官方mv|mv|flac|320kbps)[^\]]*\]/ig,'')
    .replace(/【(?:hi[ -]?res|无损音质|高音质|音质提升|4k|8k|完整版|歌词版|官方mv|mv|flac|320kbps)[^】]*】/ig,'')
    .replace(/^(?:[|｜\s·:：-]|音乐分享|音乐推荐)+/g,'').trim();
  const q=t.match(/[《“「]([^》”」]{1,65})[》”」]/);
  if(q)t=q[1];
  return t.slice(0,100).trim();
}
function cleanField(s,max=140){return String(s||'').replace(/[\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);}
function rawFrame(id,payload,version){
  const head=Buffer.alloc(10);head.write(id,0,4,'ascii');
  if(version===4)syncsafe(payload.length).copy(head,4);else head.writeUInt32BE(payload.length,4);
  return Buffer.concat([head,payload]);
}
function textFrame(id,value,version){
  const val=cleanField(value);if(!val)return Buffer.alloc(0);
  const payload=version===4?Buffer.concat([Buffer.from([3]),Buffer.from(val,'utf8')]):Buffer.concat([Buffer.from([1,0xff,0xfe]),Buffer.from(val,'utf16le')]);
  return rawFrame(id,payload,version);
}
function parseFrames(audio){
  if(audio.length<10||audio.toString('ascii',0,3)!=='ID3')return {version:3,frames:[]};
  const version=audio[3];if(version!==3&&version!==4)return {version:3,frames:[]};
  const flags=audio[5];if(flags&0xc0)return {version:3,frames:[]};
  const end=Math.min(audio.length,10+decodeSyncsafe(audio,6));let cursor=10;
  if(flags&0x40){
    if(cursor+4>end)return {version:3,frames:[]};
    const extended=version===4?decodeSyncsafe(audio,cursor):audio.readUInt32BE(cursor)+4;
    if(extended<4||cursor+extended>end)return {version:3,frames:[]};cursor+=extended;
  }
  const frames=[];
  while(cursor+10<=end){
    const id=audio.toString('ascii',cursor,cursor+4);if(!/^[A-Z0-9]{4}$/.test(id))break;
    const size=version===4?decodeSyncsafe(audio,cursor+4):audio.readUInt32BE(cursor+4);
    if(!size||cursor+10+size>end)break;
    const f1=audio[cursor+8],f2=audio[cursor+9];
    if(f1===0&&f2===0)frames.push({id,payload:audio.subarray(cursor+10,cursor+10+size)});
    cursor+=10+size;
  }
  return {version,frames};
}
function pictureFrame(buffer,version){
  const {mime}=detectImage(buffer);
  return rawFrame('APIC',Buffer.concat([Buffer.from([0]),Buffer.from(mime+'\0','ascii'),Buffer.from([3,0]),buffer]),version);
}
function metadataBuffer(meta,oldAudio=Buffer.alloc(0),cover=null){
  const {version,frames}=parseFrames(oldAudio);
  const kept=frames.filter(x=>!['TIT2','TPE1','TALB'].includes(x.id) && !(cover&&x.id==='APIC'));
  const content=Buffer.concat([
    textFrame('TIT2',meta.title,version),textFrame('TPE1',meta.artist,version),textFrame('TALB',meta.album,version),
    ...(cover?[pictureFrame(cover,version)]:[]),...kept.map(x=>rawFrame(x.id,x.payload,version))
  ]);
  if(content.length>5*1024*1024)throw new Error('MP3 标签信息过长');
  return Buffer.concat([Buffer.from([0x49,0x44,0x33,version,0,0]),syncsafe(content.length),content]);
}
function stripPreviousId3(audio){
  if(audio.length<10 || audio.toString('ascii',0,3)!=='ID3')return audio;
  const flag=audio[5],version=audio[3],size=decodeSyncsafe(audio,6);
  const end=10+size+(version===4&&(flag&0x10)?10:0);
  if(end>audio.length)throw new Error('MP3 原标签结构有误');return audio.subarray(end);
}
function extractCover(audio){
  for(const x of parseFrames(audio).frames){
    if(x.id!=='APIC'||!x.payload.length)continue;
    // Support latin-1/UTF-8 and the common empty-description APIC form.
    const enc=x.payload[0];if(enc!==0&&enc!==3)continue;
    const mimeEnd=x.payload.indexOf(0,1);if(mimeEnd<0)continue;
    const descEnd=x.payload.indexOf(0,mimeEnd+2);if(descEnd<0)continue;
    const bytes=x.payload.subarray(descEnd+1);
    try{detectImage(bytes);return bytes;}catch{}
  }
  return null;
}
async function writeTags(file,meta,cover=null){
  const audio=await fs.readFile(file);
  const result=Buffer.concat([metadataBuffer(meta,audio,cover),stripPreviousId3(audio)]);
  const temp=path.join(path.dirname(file),'.'+randomUUID()+'.tagpart');
  try{await fs.writeFile(temp,result,{flag:'wx'});await fs.rename(temp,file);}finally{await fs.unlink(temp).catch(()=>{});}
  return {size:result.length,sha256:createHash('sha256').update(result).digest('hex')};
}
module.exports={titleFromVideo,cleanField,metadataBuffer,stripPreviousId3,extractCover,writeTags};
