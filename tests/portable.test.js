'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {prepareData}=require('../data-location');
test('release root whitelist excludes user data and contains all local modules',async()=>{
  const {FILES}=require('../scripts/build-portable');
  assert.equal(FILES.some(x=>/(data[\\/]|session\.json|library\.json|\.env|runtime\.json)/.test(x)),false);
  const root=path.resolve(__dirname,'..');
  for(const file of (await fs.readdir(root)).filter(x=>x.endsWith('.js')))assert.ok(FILES.includes(file),`Missing module ${file}`);
});
test('migration copies legacy library and session without overwriting user data',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cloudtune-portable-'));
  try{
    const root=path.join(tmp,'old');const state=path.join(tmp,'account');
    await fs.mkdir(path.join(root,'data','tracks'),{recursive:true});
    await fs.writeFile(path.join(root,'data','library.json'),'[{"id":"old"}]');
    await fs.writeFile(path.join(root,'data','session.json'),'encrypted-test');
    await fs.writeFile(path.join(root,'data','tracks','test.mp3'),'test-audio');
    const data=await prepareData(root,state);
    assert.equal(await fs.readFile(path.join(data,'tracks','test.mp3'),'utf8'),'test-audio');
    assert.equal(await fs.readFile(path.join(root,'data','session.json'),'utf8'),'encrypted-test');
    await fs.writeFile(path.join(data,'library.json'),'[{"id":"new"}]');
    assert.equal(await prepareData(root,state),data);
    assert.equal(await fs.readFile(path.join(data,'library.json'),'utf8'),'[{"id":"new"}]');
  }finally{await fs.rm(tmp,{recursive:true,force:true});}
});
test('fresh user receives an empty persistent directory',async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cloudtune-new-'));
  try{const data=await prepareData(path.join(tmp,'app'),path.join(tmp,'user'));assert.deepEqual(await fs.readdir(data),[]);}
  finally{await fs.rm(tmp,{recursive:true,force:true});}
});
