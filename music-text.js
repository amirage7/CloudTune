'use strict';
const toSimplified=require('opencc-js').Converter({from:'tw',to:'cn'});
function simplify(value){return toSimplified(String(value||'').normalize('NFKC'));}
module.exports={simplify};
