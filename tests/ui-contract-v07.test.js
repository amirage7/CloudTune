'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('all statically referenced UI elements exist after discovery redesign',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 const script=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]));
 const missing=[...new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(x=>x[1]))].filter(id=>!ids.has(id));
 assert.deepEqual(missing,[]);
});
