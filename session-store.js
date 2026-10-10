'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');

// Windows DPAPI binds the encrypted credential to the current Windows user.
function protect(bytes,decrypt=false){
 if(process.platform!=='win32')return Promise.reject(new Error('记住登录目前需要 Windows；请在 Windows 电脑上运行此版本'));
 const operation=decrypt?'Unprotect':'Protect';
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[System.Security.Cryptography.ProtectedData]::${operation}($b,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  let output='';const timer=setTimeout(()=>{child.kill();reject(new Error('本机登录加密操作超时'));},15000);
  child.stdout.on('data',b=>{output+=b;});child.stdin.on('error',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(new Error('无法调用 Windows 登录加密服务'));});
  child.once('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('无法读取或保存本机加密登录，请重新登录'));resolve(Buffer.from(output.trim(),'base64'));});
  child.stdin.end(bytes.toString('base64'));
 });
}
function createSessionStore(directory){
 const filename=path.join(directory,'session.json');let pending=Promise.resolve();
 function ordered(fn){const result=pending.then(fn);pending=result.catch(()=>{});return result;}
 return {
  async load(){
   try{
    const file=JSON.parse(await fs.readFile(filename,'utf8'));
    if(file.version!==1 || typeof file.encrypted!=='string')return null;
    const saved=JSON.parse((await protect(Buffer.from(file.encrypted,'base64'),true)).toString('utf8'));
    if(typeof saved.cookie!=='string' || !saved.cookie)return null;
    return {cookie:saved.cookie,key:'',name:String(saved.name||'已连接'),userId:String(saved.userId||'')};
   }catch(e){if(e.code!=='ENOENT')console.warn('[CloudTune] 已保存登录无法恢复，请重新登录。');return null;}
  },
  save(session){return ordered(async()=>{
   const encrypted=await protect(Buffer.from(JSON.stringify({cookie:session.cookie,name:session.name,userId:session.userId}),'utf8'));
   await fs.mkdir(directory,{recursive:true});const temp=filename+'.'+crypto.randomUUID()+'.tmp';
   try{await fs.writeFile(temp,JSON.stringify({version:1,encrypted:encrypted.toString('base64')}),{mode:0o600});await fs.rename(temp,filename);}
   finally{await fs.unlink(temp).catch(()=>{});}
  });},
  clear(){return ordered(()=>fs.rm(filename,{force:true}));}
 };
}
module.exports={createSessionStore};
