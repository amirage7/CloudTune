'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const net=require('node:net');const path=require('node:path');const {spawn}=require('node:child_process');
const {proxyEnvironment}=require('../network-bootstrap');
test('system proxy is applied without routing local app requests through it',()=>{
 const before={PATH:'fixture',NO_PROXY:'example.test'};const r=proxyEnvironment(before,{enabled:true,server:'127.0.0.1:7890'});
 assert.equal(r.env.HTTP_PROXY,'http://127.0.0.1:7890');assert.equal(r.env.HTTPS_PROXY,'http://127.0.0.1:7890');assert.match(r.env.NO_PROXY,/127\.0\.0\.1/);assert.match(r.env.NO_PROXY,/localhost/);assert.match(r.env.NO_PROXY,/::1/);assert.match(r.env.NO_PROXY,/example\.test/);assert.deepEqual(before,{PATH:'fixture',NO_PROXY:'example.test'});
});
test('explicit environment proxy wins; protocol-specific and disabled system settings are handled',()=>{
 const explicit=proxyEnvironment({https_proxy:'http://127.0.0.1:9999'},{enabled:true,server:'127.0.0.1:7890'});assert.equal(explicit.env.HTTPS_PROXY,'http://127.0.0.1:9999');
 const split=proxyEnvironment({},{enabled:true,server:'http=127.0.0.1:7890;https=127.0.0.1:7891;socks=127.0.0.1:7892'});assert.equal(split.env.HTTPS_PROXY,'http://127.0.0.1:7891');
 assert.equal(proxyEnvironment({},{enabled:false,server:'127.0.0.1:7890'}).env.HTTP_PROXY,undefined);
 assert.equal(proxyEnvironment({},{enabled:true,server:'socks=127.0.0.1:7890'}).env.HTTP_PROXY,undefined);
});
test('bundled runtime routes remote fetch through configured proxy and keeps loopback direct',{timeout:15000},async()=>{
 let proxied=0;const proxy=http.createServer((req,res)=>{proxied++;assert.match(req.url,/^http:\/\/cloudtune-fixture\.invalid/);res.end('proxy-ok');});const local=http.createServer((req,res)=>res.end('local-ok'));
 const upstream=http.createServer((req,res)=>res.end('proxy-ok'));await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 proxy.on('connect',(req,socket,head)=>{proxied++;assert.equal(req.url,'cloudtune-fixture.invalid:80');const target=net.connect(upstream.address().port,'127.0.0.1',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)target.write(head);socket.pipe(target);target.pipe(socket);});target.on('error',()=>socket.destroy());socket.on('error',()=>target.destroy());});
 await new Promise(r=>proxy.listen(0,'127.0.0.1',r));await new Promise(r=>local.listen(0,'127.0.0.1',r));
 try{const configured=proxyEnvironment({...process.env,HTTP_PROXY:'http://127.0.0.1:'+proxy.address().port,HTTPS_PROXY:'',http_proxy:'',https_proxy:'',ALL_PROXY:'',all_proxy:'',NO_PROXY:'',no_proxy:''},{enabled:false});
 const executable=path.join(__dirname,'../.packaging/node/node-v22.23.3-win-x64/node.exe');
 const script=`Promise.all([fetch('http://cloudtune-fixture.invalid/music'),fetch('http://127.0.0.1:${local.address().port}/api/health')]).then(async rows=>{console.log(await rows[0].text());console.log(await rows[1].text());}).catch(e=>{console.error(e.message);process.exitCode=1;});`;
 const result=await new Promise((resolve,reject)=>{const child=spawn(executable,['--use-env-proxy','-e',script],{env:configured.env,windowsHide:true});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);child.once('exit',code=>resolve({code,output}));});
 assert.equal(result.code,0,result.output);assert.match(result.output,/proxy-ok/);assert.match(result.output,/local-ok/);assert.equal(proxied,1);
 }finally{await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>local.close(r)),new Promise(r=>upstream.close(r))]);}
});
