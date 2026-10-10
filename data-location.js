'use strict';
const fs=require('node:fs/promises');const path=require('node:path');
async function exists(file){try{await fs.access(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function prepareData(root,state){
  const data=path.join(state,'data');await fs.mkdir(state,{recursive:true});
  if(await exists(data))return data;
  const legacy=path.join(root,'data');
  if(await exists(path.join(legacy,'library.json')) || await exists(path.join(legacy,'session.json'))){
    const staging=await fs.mkdtemp(path.join(state,'migration-'));
    try{await fs.cp(legacy,staging,{recursive:true});await fs.rename(staging,data);}
    finally{await fs.rm(staging,{recursive:true,force:true});}
    console.log('已复制旧版音乐库和登录记录；原文件仍保留。');
  }else await fs.mkdir(data,{recursive:true});
  return data;
}
module.exports={prepareData};
