'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
test('late automatic recognition never overwrites text the user has edited',async()=>{
 const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{value:'',textContent:'',replaceChildren(){}});return nodes.get(id);};
 let respond;const context=vm.createContext({$,post:()=>new Promise(resolve=>{respond=resolve;}),encodeURIComponent});
 const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('let biliProposal='),source.indexOf('function prepareBili(')),context);
 $('bili-import-url').value='https://www.bilibili.com/video/BV1xx411c7mD/';$('bili-import-title').value='旧标题';
 const running=context.recognizeBili();$('bili-import-title').value='我修正的标题';$('bili-import-artist').value='我修正的歌手';
 respond({proposal:{title:'候选歌曲',artist:'候选歌手',source:'曲库'},confidence:'high',suggestions:[]});await running;
 assert.equal($('bili-import-title').value,'我修正的标题');assert.equal($('bili-import-artist').value,'我修正的歌手');
});
