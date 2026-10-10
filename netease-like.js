'use strict';
/** Cloud song -> liked playlist. Never claim success without a verified list entry. */
function numberId(value){const s=String(value??'');return /^\d{1,19}$/.test(s) && s!=='0'?s:'';}
function cloudRows(body){return Array.isArray(body?.data)?body.data:Array.isArray(body?.data?.data)?body.data.data:[];}
function cloudId(row){return numberId(row?.songId || row?.simpleSong?.id || row?.song?.id || row?.id);}
function norm(x){return String(x||'').toLowerCase().replace(/\.[^.]+$/,'').replace(/[\s\-—_【】\[\]（）()《》<>·.]+/g,'');}
function identifyUploadedSong(uploadBody,rows,entry){
  const proposed=numberId(uploadBody?.songId || uploadBody?.data?.songId || uploadBody?.data?.simpleSong?.id || uploadBody?.privateCloud?.songId);
  if(proposed && rows.some(row=>cloudId(row)===proposed))return proposed;
  // V0.5 transmitted a corrected filename but only remembered the original Bilibili title.
  const filenames=[entry.uploadFileName,entry.name, entry.artist&&entry.title&&entry.format?`${entry.artist} - ${entry.title}.${entry.format.toLowerCase()}`:null].filter(Boolean).map(norm);
  const title=norm(entry.title),artist=norm(entry.artist);
  const fileMatches=rows.filter(row=>filenames.includes(norm(row.fileName||row.filename)));
  if(fileMatches.length===1 && cloudId(fileMatches[0]))return cloudId(fileMatches[0]);
  const nameMatches=rows.filter(row=>{
    const remoteTitle=norm(row.songName||row.simpleSong?.name);
    const remoteArtist=norm(row.artist || row.simpleSong?.ar?.map(x=>x.name).join(','));
    return !!title && !!artist && remoteTitle===title && remoteArtist===artist;
  });
  if(nameMatches.length===1 && cloudId(nameMatches[0]))return cloudId(nameMatches[0]);
  return '';
}
async function lookupCloudSongId(sdk,cookie,entry,uploadBody){
  if(typeof sdk.user_cloud!=='function')throw new Error('第三方接口不支持查询云盘歌曲 ID');
  for(let attempt=0;attempt<3;attempt++){
    if(attempt)await new Promise(r=>setTimeout(r,800*attempt));
    const rows=[];
    for(let page=0;page<5;page++){
      const r=await sdk.user_cloud({cookie,limit:200,offset:page*200,timestamp:Date.now()});
      if(r?.body?.code!==200)throw new Error(r?.body?.message || '无法读取网易云云盘歌曲列表');
      const batch=cloudRows(r.body);rows.push(...batch);
      if(batch.length<200)break;
    }
    const id=identifyUploadedSong(uploadBody,rows,entry);
    if(id)return id;
  }
  throw new Error('上传成功但未能唯一识别云盘歌曲 ID。请到网易云云盘检查歌曲并稍后重试；不会自动收藏其他歌曲');
}
function success(body){return Number(body?.code)===200;}
function listIds(body){return Array.isArray(body?.ids)?body.ids.map(numberId).filter(Boolean):null;}
async function getLikedPlaylistId(sdk,cookie,userId){
  if(typeof sdk.user_playlist!=='function')throw new Error('第三方接口缺少读取用户歌单的能力');
  const r=await sdk.user_playlist({uid:userId,cookie,limit:1000,offset:0,timestamp:Date.now()});
  if(!success(r?.body) || !Array.isArray(r.body.playlist))throw new Error('无法获取个人歌单');
  const own=r.body.playlist.filter(p=>!p.creator?.userId||String(p.creator.userId)===String(userId));
  const candidates=own.filter(p=>Number(p.specialType)===5);
  if(candidates.length!==1)throw new Error('无法唯一识别「我喜欢的音乐」歌单，为避免加入其他歌单已停止');
  const pid=numberId(candidates[0].id);
  if(!pid)throw new Error('喜欢歌单 ID 无效');
  return pid;
}
async function playlistHasSong(sdk,cookie,pid,songId){
  if(typeof sdk.playlist_detail!=='function')return null;
  const r=await sdk.playlist_detail({id:pid,cookie,timestamp:Date.now()});
  if(!success(r?.body))return null;
  const entries=r.body.playlist?.trackIds;
  if(!Array.isArray(entries))return null;
  return entries.some(x=>numberId(x.id)===songId);
}
async function ensureLiked({sdk,cookie,userId,songId}){
  const uid=numberId(userId),id=numberId(songId);
  if(!uid||!id)throw new Error('网易云账号或云盘歌曲 ID 无效');
  let checkError='';
  async function checkLiked(){
    if(typeof sdk.likelist!=='function')return null;
    const r=await sdk.likelist({uid,cookie,timestamp:Date.now()});
    if(!success(r?.body))throw new Error(r?.body?.message||'无法读取喜欢列表');
    const ids=listIds(r.body);
    if(!ids)throw new Error('喜欢列表响应缺少歌曲 ID');
    return ids.includes(id);
  }
  async function verify(pid){
    for(let n=0;n<3;n++){
      if(n)await new Promise(resolve=>setTimeout(resolve,600*n));
      try{if(await checkLiked()===true)return 'likelist';}catch(e){checkError=String(e.message);}
      if(pid){const contains=await playlistHasSong(sdk,cookie,pid,id);if(contains===true)return 'playlist';}
    }
    return '';
  }
  if(await verify(''))return {liked:true,skipped:true,method:'already-liked'};
  let directError='';
  const likeApi=typeof sdk.like==='function'?sdk.like:typeof sdk.like_v1==='function'?sdk.like_v1:null;
  if(likeApi){
    try{
      const r=await likeApi({id,like:true,cookie,timestamp:Date.now()});
      if(!success(r?.body))throw new Error(r?.body?.message||r?.body?.msg||`喜欢接口返回 ${r?.body?.code||r?.status||'未知状态'}`);
      const verified=await verify('');
      if(verified)return {liked:true,skipped:false,method:'like'};
      directError='喜欢接口返回成功，但列表未确认';
    }catch(e){directError=String(e.message||e);}
  }else directError='喜欢接口不可用';
  // Fallback is *only* the owner's specialType=5 playlist; never guess playlist IDs.
  try{
    const pid=await getLikedPlaylistId(sdk,cookie,uid);
    if(await verify(pid))return {liked:true,skipped:true,method:'playlist-existing'};
    if(typeof sdk.playlist_tracks!=='function')throw new Error('第三方接口缺少 playlist_tracks 方法');
    const r=await sdk.playlist_tracks({op:'add',pid,tracks:id,cookie,timestamp:Date.now()});
    if(!success(r?.body))throw new Error(r?.body?.message||r?.body?.msg||`歌单接口返回 ${r?.body?.code||r?.status||'未知状态'}`);
    const verified=await verify(pid);
    if(verified)return {liked:true,skipped:false,method:'playlist',verifiedBy:verified};
    throw new Error('歌单添加接口返回成功，但列表没有这首歌');
  }catch(e){
    throw new Error(`喜欢未确认：直接喜欢（${directError}）；歌单备用方式（${String(e.message||e)}）${checkError?'；列表查询（'+checkError+'）':''}`);
  }
}
module.exports={numberId,cloudRows,cloudId,identifyUploadedSong,lookupCloudSongId,ensureLiked,getLikedPlaylistId,playlistHasSong};
