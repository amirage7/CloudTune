'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {validateArtworkUrl,findExactCandidate}=require('../cover-art');
test('NetEase album CDN is accepted over HTTPS while arbitrary or spoofed hosts are rejected',()=>{
 assert.equal(validateArtworkUrl('https://p3.music.126.net/album.jpg'),'https://p3.music.126.net/album.jpg');
 for(const url of ['https://p3.music.126.net.evil.test/a.jpg','https://127.0.0.1/a.jpg','http://p3.music.126.net/a.jpg'])assert.throws(()=>validateArtworkUrl(url));
});
test('joint artist spelling can match the same artist credits but never another performer',()=>{
 const rows=[{title:'一纸情书',artist:'毛不易 / 岳云鹏',artworkUrl:'https://p3.music.126.net/a.jpg'}];
 assert.equal(findExactCandidate(rows,'一纸情书','毛不易 岳云鹏'),rows[0]);assert.equal(findExactCandidate(rows,'一纸情书','其他歌手'),null);
});
test('video evidence ranks correct joint credits over unrelated hits and uploader names',async()=>{
 const {recognizeMetadata}=require('../metadata-recognition');
 const result=await recognizeMetadata({videoTitle:'《一纸情书》-毛不易 岳云鹏【Hi-Res无损音质】',uploader:'可爱的丁丁猫'},async q=>[
 {title:'消愁',artist:'毛不易'}, {title:'一纸情书',artist:'可爱的丁丁猫'},
 {title:'一纸情书',artist:'毛不易 / 岳云鹏',album:'单曲',artworkUrl:'https://p3.music.126.net/a.jpg',source:'网易云'}]);
 assert.equal(result.proposal.title,'一纸情书');assert.equal(result.proposal.artist,'毛不易 / 岳云鹏');assert.equal(result.confidence,'high');
});
test('cover and live versions without matching performer evidence do not silently adopt original studio credits',async()=>{
 const {recognizeMetadata}=require('../metadata-recognition');
 const result=await recognizeMetadata({videoTitle:'小明翻唱《稻香》现场版'},async()=>[{title:'稻香',artist:'周杰伦',album:'魔杰座'}]);
 assert.equal(result.proposal.artist,'');assert.equal(result.proposal.artworkUrl,'');assert.match(result.warning,/版本|翻唱/);
});
test('network failure leaves editable title proposal and explains why artist is unknown',async()=>{
 const {recognizeMetadata}=require('../metadata-recognition');const result=await recognizeMetadata({videoTitle:'《稻香》'},async()=>{throw new Error('offline');});
 assert.equal(result.proposal.title,'稻香');assert.equal(result.proposal.artist,'');assert.ok(result.warning);
});
test('explicit video credits are preserved when catalogs only contain other artists covers',async()=>{
 const {recognizeMetadata}=require('../metadata-recognition');
 const r=await recognizeMetadata({videoTitle:'《一纸情书》-毛不易 岳云鹏【Hi-Res无损音质】'},async()=>[{title:'一纸情书',artist:'瞳野',album:'翻唱',artworkUrl:'https://p3.music.126.net/cover.jpg'}]);
 assert.equal(r.proposal.artist,'毛不易 / 岳云鹏');assert.equal(r.proposal.artworkUrl,'');assert.equal(r.confidence,'low');
});
test('unquoted artist and song titles can match catalog evidence',async()=>{
 const {recognizeMetadata}=require('../metadata-recognition');
 const r=await recognizeMetadata({videoTitle:'周杰伦 - 稻香【无损音质】'},async()=>[{title:'稻香',artist:'周杰伦',album:'魔杰座'}]);
 assert.equal(r.proposal.title,'稻香');assert.equal(r.proposal.artist,'周杰伦');
});
test('actual video title retains a singer despite trailing quality claims and targets their version',async()=>{
 const {recognizeMetadata}=require('../metadata-recognition');const queries=[];
 const r=await recognizeMetadata({videoTitle:'【4K顶级修复】《止战之殇》—周杰伦 无损音质',description:'歌曲名：《止战之殇》 作词：方文山 作曲：周杰伦 编曲：周杰伦'},async q=>{queries.push(q);return q.includes('周杰伦')?[{title:'止戰之殤',artist:'周杰倫',album:'七里香',artworkUrl:'https://is1-ssl.mzstatic.com/a.jpg',source:'Apple 音乐目录'}]:[{title:'止战之殇',artist:'秦一豪'}];});
 assert.ok(queries.some(q=>q.includes('止战之殇')&&q.includes('周杰伦')));assert.equal(r.proposal.artist,'周杰伦');assert.equal(r.proposal.album,'七里香');assert.equal(r.confidence,'high');
});
test('singer roles in descriptions are queried while lyricists and original singer of a cover are not selected as performer',async()=>{
 const {recognizeMetadata}=require('../metadata-recognition');const queries=[];
 const r=await recognizeMetadata({videoTitle:'《止战之殇》翻唱',description:'演唱：小明；原唱：周杰伦；作词：方文山'},async q=>{queries.push(q);return [{title:'止战之殇',artist:'周杰伦',album:'七里香'},{title:'止战之殇',artist:'小明',album:'翻唱作品'}];});
 assert.ok(queries.some(q=>q.includes('小明')));assert.equal(r.proposal.artist,'小明');
});
test('title and artist matching treats Traditional and Simplified Chinese equivalently',()=>{
 assert.equal(require('../cover-art').normalizeForMatch('止戰之殤 周杰倫'),require('../cover-art').normalizeForMatch('止战之殇 周杰伦'));
});
test('Apple metadata falls back to another catalog region when CN has no entries',async()=>{
 const regions=[];const rows=await require('../sources').searchMetadataCandidates('止战之殇 周杰伦',async url=>{const country=new URL(url).searchParams.get('country');regions.push(country);return country==='CN'?{results:[]}:{results:[{trackName:'止戰之殤',artistName:'周杰倫',collectionName:'七里香',artworkUrl100:'https://is1-ssl.mzstatic.com/100x100bb.jpg',trackViewUrl:'https://music.apple.com/hk/album/song/123'}]};});
 assert.ok(regions.includes('HK'));assert.equal(rows[0].title,'止战之殇');assert.equal(rows[0].artist,'周杰伦');assert.ok(rows[0].pageUrl);
});
