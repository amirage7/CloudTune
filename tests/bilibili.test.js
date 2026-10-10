'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {bilibiliSearchLink,cleanBilibiliTitle,classifyVideo,parseVideoResults,searchBilibili}=require('../bilibili');
const {searchAll}=require('../sources');
function fixture(){return {code:0,data:{result:[
  {bvid:'BV1xx411c7mD',title:'<em class="keyword">稻香</em> - 官方 MV',author:'音乐频道',duration:'03:45'},
  {bvid:'BV1xx411c7mE',title:'稻香 现场 Live',author:'演唱会剪辑',duration:'4:15'},
  {bvid:'invalid',title:'malformed',author:'skip'}]}};}

test('construct Bilibili official search links without injection',()=>{
  const url=new URL(bilibiliSearchLink('稻香 周杰伦','cover'));
  assert.equal(url.hostname,'search.bilibili.com');
  assert.equal(url.searchParams.get('keyword'),'稻香 周杰伦 翻唱');
  assert.equal(new URL(bilibiliSearchLink('a&b')).searchParams.get('keyword'),'a&b');
});
test('Bilibili discovery records are strictly video only',()=>{
  const videos=parseVideoResults(fixture());
  assert.equal(videos.length,2);
  assert.equal(videos[0].title,'稻香 - 官方 MV');
  assert.equal(videos[0].artist,'音乐频道');
  assert.equal(videos[0].kind,'bilibili');
  assert.equal(videos[0].downloadable,false);
  assert.equal(videos[0].url,'');
  assert.equal(videos[0].pageUrl,'https://www.bilibili.com/video/BV1xx411c7mD/');
  assert.equal(videos[1].version,'现场版');
  assert.equal(classifyVideo('Piano cover'),'翻唱 / 演奏');
  assert.equal(cleanBilibiliTitle('<em>Song</em>'),'Song');
});
test('Bilibili automated search collects only metadata when endpoint responds',async()=>{
  const fakeFetch=async(url)=>({ok:true,json:async()=>fixture()});
  const result=await searchBilibili('稻香',fakeFetch);
  assert.equal(result.length,2);
  assert.ok(result.every(x=>!x.downloadable));
});
test('Bilibili API restrictions fail safely and leave official web fallback',async()=>{
  const fakeFetch=async()=>({ok:false,status:412});
  await assert.rejects(()=>searchBilibili('稻香',fakeFetch),/B站网页搜索/);
  assert.match(bilibiliSearchLink('稻香'),/^https:\/\/search\.bilibili\.com/);
});
test('unified search includes Bilibili video results without enabling downloads',async()=>{
  const result=await searchAll('稻香','',{commons:async()=>[],archive:async()=>[],openverse:async()=>[],catalog:async()=>[],bilibili:async()=>parseVideoResults(fixture())});
  assert.equal(result.hits.length,2);
  assert.ok(result.hits.every(x=>x.kind==='bilibili'&&!x.downloadable));
});
