'use strict';
const {simplify}=require('./music-text');
const norm=x=>simplify(x).toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
function classifyVersion(title){const t=String(title||'').toLowerCase();if(/伴奏|karaoke|instrumental/.test(t))return 'instrumental';if(/翻唱|cover|翻奏/.test(t))return 'cover';if(/remix|混音|改编/.test(t))return 'remix';if(/live|现场|演唱会|音乐节/.test(t))return 'live';if(/官方|official|原版|原唱|录音室/.test(t))return 'original';return 'unknown';}
function rankSources(query,rows,desired='original'){
 const tokens=simplify(query).toLowerCase().split(/[\s《》]+/).filter(Boolean).map(norm);const q=norm(query);
 return rows.map((item,index)=>{
  const title=norm(item.title),text=norm(item.title+' '+item.artist);const category=classifyVersion(item.title);const matched=tokens.filter(x=>text.includes(x)).length;
  let score=matched*30+(title.includes(q)||q.includes(title)&&title.length>1?20:0);const reasons=[];
  if(matched)reasons.push(matched===tokens.length?'搜索词与标题／演唱者线索匹配':'部分搜索词匹配');
  if(category===desired){score+=18;reasons.push('标题含所选版本线索');}else if(category!=='unknown'){score-=15;reasons.push('标题指向其他版本');}
  const usable=item.downloadable||item.kind==='bilibili';if(usable&&matched)score+=8;if(item.kind==='catalog')score-=60;
  const availability=usable?'pending':'reference';
  return {...item,category,score,reasons,match:matched===tokens.length?'matched':matched?'partial':'unknown',availability,quality:'未检测',versionConfirmed:false,_order:index};
 }).sort((a,b)=>b.score-a.score||a._order-b._order).map(({_order,...x})=>x);
}
module.exports={rankSources,classifyVersion};
