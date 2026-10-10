'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');
function createIngestion(directory,hooks){
 const file=path.join(directory,'tasks.json');let tasks=[],active=false,write=Promise.resolve(),closed=false;
 const terminal=new Set(['done','partial','failed','cancelled','interrupted']);
 function save(){const snapshot=JSON.stringify(tasks,null,2);const next=write.then(async()=>{await fs.mkdir(directory,{recursive:true});await fs.writeFile(file+'.tmp',snapshot);await fs.rename(file+'.tmp',file);});write=next.catch(()=>{});return next;}
 function list(){return JSON.parse(JSON.stringify(tasks)).reverse();}
 async function phase(t,stage,message){t.stage=stage;t.message=message;t.updatedAt=new Date().toISOString();t.logs.push({stage,message,time:t.updatedAt});t.logs=t.logs.slice(-25);await save();}
 function check(t){if(closed||t.cancelled)throw new Error('任务已取消');const account=hooks.account();if(!account.connected || account.id!==t.accountId)throw new Error('账号未连接或已切换，请重新连接任务使用的账号');}
 async function execute(t){
  try{
   t.status='running';t.error='';await phase(t,'checking','检查账号、音源和已有文件');check(t);
   if(!t.entryId){await phase(t,'acquiring','检查并获取音频');const entry=await hooks.acquire(t.source,t.metadata,async message=>{await phase(t,'acquiring',message);},cancel=>{t.cancelWorker=cancel;});t.entryId=entry.id;t.source.availability='verified';delete t.cancelWorker;await save();}
   check(t);await phase(t,'metadata','完善歌曲信息与封面');check(t);await hooks.prepare(t.entryId,t.metadata);
   check(t);await phase(t,'uploading','上传云盘，并核验云盘与喜欢状态');check(t);const entry=await hooks.upload(t.entryId);
   t.cloudStatus=entry.cloudStatus;t.uploadVerified=entry.uploadVerified===true;t.likedStatus=entry.likedStatus;t.coverPending=!entry.coverExt||entry.cloudCoverPending===true;
   t.status=t.uploadVerified && entry.likedStatus==='liked' && !t.coverPending?'done':'partial';
   await phase(t,'finished',t.status==='done'?'云盘与喜欢已核验':'已保留成果；'+[!t.uploadVerified?'云盘待核验':'',entry.likedStatus!=='liked'?'喜欢待核验':'',t.coverPending?(entry.coverExt?'本地封面已补齐，已上传的旧文件需手动更新':'封面待完善'):''].filter(Boolean).join('、'));
  }catch(e){delete t.cancelWorker;if(t.stage==='acquiring'&&!t.entryId&&!t.cancelled)t.source.availability='unavailable';t.status=t.cancelled?'cancelled':closed?'interrupted':'failed';t.error=String(e.message||e).slice(0,350);await phase(t,'stopped',t.error).catch(()=>{});}
 }
 async function pump(){if(active||closed)return;active=true;try{for(const t of tasks){if(t.status==='queued')await execute(t);if(closed)break;}}finally{active=false;}}
 function submit({source,metadata,confirmedRights}){
  if(confirmedRights!==true)throw new Error('请确认音源使用权限');
  if(!metadata?.title?.trim()||!metadata?.artist?.trim()||metadata.artist==='未知艺术家')throw new Error('请确认歌曲名和实际演唱者');
  const account=hooks.account();if(!account.connected)throw new Error('请先连接网易云账号');
  const existing=tasks.find(t=>!terminal.has(t.status)&&t.source.id===source.id);if(existing)return {...existing};
  const t={id:randomUUID(),accountId:account.id,source,metadata,entryId:'',status:'queued',stage:'queued',message:'等待处理',logs:[],createdAt:new Date().toISOString()};tasks.push(t);
  save().then(pump).catch(e=>{t.status='failed';t.error='无法保存任务：'+e.message;});return {...t};
 }
 async function retry(id){const t=tasks.find(x=>x.id===id);if(!t)throw new Error('任务不存在');if(t.status==='done')throw new Error('任务已完成');if(!terminal.has(t.status))throw new Error('任务仍在进行');check({...t,cancelled:false});t.cancelled=false;t.status='queued';await save();void pump();return {...t};}
 async function cancel(id){const t=tasks.find(x=>x.id===id);if(!t)throw new Error('任务不存在');if(terminal.has(t.status))return;t.cancelled=true;if(t.cancelWorker)await t.cancelWorker();if(t.status==='queued')t.status='cancelled';await save();}
 return {list,submit,retry,cancel,async init(){try{tasks=JSON.parse(await fs.readFile(file,'utf8'));if(!Array.isArray(tasks))tasks=[];}catch(e){if(e.code!=='ENOENT')throw new Error('任务记录无法读取，请保留 tasks.json 并检查文件');}for(const t of tasks)if(!terminal.has(t.status)){t.status='interrupted';t.message='上次运行中断，点击重试从已保存的文件继续';}await save();},async close(){closed=true;for(const t of tasks)if(t.cancelWorker)await t.cancelWorker();for(const t of tasks)if(t.status==='running'||t.status==='queued'){t.status='interrupted';t.message='程序退出，任务待恢复';}await save();}};
}
module.exports={createIngestion};

