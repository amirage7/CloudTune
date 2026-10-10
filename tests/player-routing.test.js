'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {parseVideoResults}=require('../bilibili');
function player(){
 const elements=new Map();
 function element(tag='div'){return {tag,children:[],handlers:{},classList:{add(){},remove(){}},replaceChildren(...children){this.children=children;},append(...children){this.children.push(...children);},removeAttribute(name){delete this[name];},addEventListener(name,fn){this.handlers[name]=fn;}};}
 const context=vm.createContext({document:{body:{style:{}}},$:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},node:element,safeUrl:url=>url,emptyMessage:(title,detail)=>({title,detail})});
 const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function openPlayer('),source.indexOf('function closePlayer(')),context);
 return {open:context.openPlayer,get:id=>context.$(id)};
}
test('real Bilibili search results open the official iframe despite having a search id',()=>{
 const item=parseVideoResults({data:{result:[{bvid:'BV1xx411c7mD',title:'一纸情书',author:'UP主'}]}})[0];
 assert.ok(item.id);const p=player();p.open(item);const media=p.get('player-stage').children[0];
 assert.equal(media.tag,'iframe');assert.match(media.src,/player\.bilibili\.com\/player\.html\?bvid=BV1xx411c7mD/);
 assert.equal(p.get('player-fallback').href,item.pageUrl);
});
test('local library playback uses local audio and reports loading, readiness and failure',()=>{
 const p=player();p.open({id:'local-file',title:'歌曲',artist:'歌手'});const audio=p.get('player-stage').children[0];
 assert.equal(audio.tag,'audio');assert.equal(audio.src,'/api/listen/local-file');
 assert.match(p.get('player-note').textContent,/加载/);audio.handlers.loadedmetadata();assert.match(p.get('player-note').textContent,/播放/);
 audio.error={code:4};audio.handlers.error();assert.match(p.get('player-note').textContent,/失败|不支持/);
});
test('invalid Bilibili results never request a search id from the local library',()=>{
 const p=player();p.open({kind:'bilibili',id:'bili_invalid',bvid:'invalid'});
 assert.notEqual(p.get('player-stage').children[0].tag,'audio');
});
