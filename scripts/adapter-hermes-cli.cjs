const http = require('http');
const { execFile } = require('child_process');
const server = http.createServer((req, res) => {
  let data='';
  req.on('data', c=>data+=c);
  req.on('end', () => {
    const started = Date.now();
    const input = JSON.parse(data).input;
    execFile('hermes', ['chat','-q',input,'-Q'], {timeout:110000, maxBuffer:1024*1024}, (err, stdout, stderr) => {
      const latency = Date.now()-started;
      if (err && !stdout) {
        res.writeHead(502,{'Content-Type':'application/json'});
        res.end(JSON.stringify({error:String(err.message||err)}));
        return;
      }
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({output:(stdout||'').trim(), latency_ms:latency, tokens:undefined, tools_called:[]}));
    });
  });
});
server.listen(11556,'127.0.0.1',()=>console.log('hermes adapter on 11556'));
