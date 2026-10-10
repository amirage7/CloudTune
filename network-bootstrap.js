'use strict';
const path=require('node:path');const {spawn,execFileSync}=require('node:child_process');
function proxyUrl(value){
 const text=String(value||'').trim();if(!text)return '';
 try{const url=new URL(text.includes('://')?text:'http://'+text);return ['http:','https:'].includes(url.protocol)&&url.hostname&&!url.search&&!url.hash&&url.pathname==='/'?url.href.replace(/\/$/,''):'';}catch{return '';}
}
function proxyEnvironment(original,system={}){
 const env={...original};let fromSystem={};
 if(system.enabled&&system.server){const value=String(system.server);if(value.includes('=')){for(const part of value.split(';')){const i=part.indexOf('=');if(i>0)fromSystem[part.slice(0,i).trim().toLowerCase()]=proxyUrl(part.slice(i+1));}}else{fromSystem.http=fromSystem.https=proxyUrl(value);}}
 const explicitHttp=proxyUrl(env.http_proxy||env.HTTP_PROXY),explicitHttps=proxyUrl(env.https_proxy||env.HTTPS_PROXY);
 const http=explicitHttp||explicitHttps||fromSystem.http||fromSystem.https||'';
 const https=explicitHttps||explicitHttp||fromSystem.https||fromSystem.http||'';
 if(http)env.HTTP_PROXY=env.http_proxy=http;
 if(https)env.HTTPS_PROXY=env.https_proxy=https;
 const bypass=new Set((String(env.no_proxy||env.NO_PROXY||'')+',localhost,127.0.0.1,::1').split(',').map(x=>x.trim()).filter(Boolean));env.NO_PROXY=env.no_proxy=Array.from(bypass).join(',');
 return {env,enabled:!!(http||https),source:explicitHttp||explicitHttps?'environment':http||https?'system':'direct'};
}
function systemProxy(){
 if(process.platform!=='win32')return {};
 try{const registry=execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe'),['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{encoding:'utf8',windowsHide:true,timeout:2500,stdio:['ignore','pipe','ignore']});
  return {enabled:/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(registry),server:registry.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim()||''};
 }catch{return {};}
}
function launch(){
 const configured=proxyEnvironment(process.env,systemProxy());const supports=process.allowedNodeEnvironmentFlags.has('--use-env-proxy');
 if(configured.enabled&&!supports){console.error('此 Node 版本不支持代理，请使用新版完整便携包内置的运行环境。');process.exitCode=1;return;}
 console.log(configured.enabled?'网络连接：使用已有代理；本地网页直连。':'网络连接：未配置代理，使用直接连接。');
 const args=[...(configured.enabled?['--use-env-proxy']:[]),path.join(__dirname,'launcher.js'),...process.argv.slice(2)];
 const child=spawn(process.execPath,args,{cwd:__dirname,env:configured.env,stdio:'inherit',windowsHide:true});
 child.once('error',()=>{console.error('无法启动 CloudTune，请重新解压完整便携包。');process.exitCode=1;});
 // Console signals go to both processes; keep the wrapper alive until the app saves and exits.
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
 child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}
if(require.main===module)launch();
module.exports={proxyEnvironment,systemProxy,launch};
