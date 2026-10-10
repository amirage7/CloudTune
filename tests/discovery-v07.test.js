'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {rankSources,classifyVersion}=require('../discovery');
test('version clues never turn cover, accompaniment or marketing into a verified original',()=>{
 assert.equal(classifyVersion('周杰伦 稻香 cover 现场'),'cover');
 assert.equal(classifyVersion('稻香 官方伴奏 MV'),'instrumental');
 assert.equal(classifyVersion('稻香 Hi-Res 无损完整版'),'unknown');
 assert.equal(classifyVersion('稻香 Remix'),'remix');
});
test('recommendations favor target and desired version; traditional text matches, quality remains unknown',()=>{
 const rows=rankSources('稻香 周杰伦',[
 {id:'wrong',title:'其他歌曲',artist:'周杰伦',downloadable:true},
 {id:'cover',title:'稻香 周杰伦 翻唱',artist:'UP',kind:'bilibili'},
 {id:'target',title:'周杰倫《稻香》官方 MV',artist:'UP',kind:'bilibili'},
 {id:'catalog',title:'稻香',artist:'周杰伦',kind:'catalog'}]);
 assert.equal(rows[0].id,'target');assert.equal(rows[0].quality,'未检测');
 assert.equal(rows[0].availability,'pending');assert.equal(rows[0].versionConfirmed,false);
 assert.equal(rows.find(x=>x.id==='catalog').availability,'reference');
 assert.ok(rows[0].reasons.length);
});
