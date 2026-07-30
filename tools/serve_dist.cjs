const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'dist');
const port = Number(process.env.STATIC_TEST_PORT || 4173);
const prefix = '/test-repo';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

http.createServer((request, response) => {
  const url = new URL(request.url, 'http://static.test');
  if (!url.pathname.startsWith(prefix)) {
    response.writeHead(404).end('not found');
    return;
  }
  let relative = decodeURIComponent(url.pathname.slice(prefix.length));
  if (!relative || relative.endsWith('/')) relative += 'index.html';
  const file = path.resolve(root, `.${relative}`);
  if (path.dirname(file) !== root && !path.dirname(file).startsWith(root + path.sep)) {
    response.writeHead(403).end('forbidden');
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    response.writeHead(404).end('not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`static test server ready on ${port}`);
});
