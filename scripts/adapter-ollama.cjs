const http = require('http');
const server = http.createServer((req, res) => {
  let data='';
  req.on('data', c=>data+=c);
  req.on('end', () => {
    const started = Date.now();
    const input = JSON.parse(data).input;
    const body = JSON.stringify({model:'qwen3.8:27b-mlx',messages:[{role:'user',content:input}],temperature:0.1,max_tokens:400,stream:false});
    const upstream = require('http').request({hostname:'127.0.0.1',port:11434,path:'/v1/chat/completions',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)}},up=>{let d='';up.on('data',c=>d+=c);up.on('end',()=>{
      try{
        const j=JSON.parse(d);
        const text=j.choices?.[0]?.message?.content||'';
        res.writeHead(200,{'Content-Type':'application/json'});
        res.end(JSON.stringify({output:text, latency_ms:Date.now()-started, tokens:j.usage?.total_tokens, tools_called:[]}));
      }catch(e){res.writeHead(502);res.end(JSON.stringify({error:String(e)}));}
    })});
    upstream.on('error',e=>{res.writeHead(502);res.end(JSON.stringify({error:e.message}))});
    upstream.end(body);
  });
});
server.listen(11555,'127.0.0.1',()=>console.log('adapter on 11555'));
