import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 5173;
const CLIENT_DIR = path.resolve('dist/client');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json'
};

if (!fs.existsSync(CLIENT_DIR)) {
  console.error('Error: dist/client does not exist. Run "npm run build" first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const urlPath = req.url?.split('?')[0] || '/';
  let filePath = path.join(CLIENT_DIR, urlPath === '/' ? 'index.html' : urlPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(CLIENT_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`
  🚀 Local Flair Analyzer Preview is running!
  👉 Open in your browser: http://localhost:${PORT}
  
  (Press Ctrl+C to stop)
`);
});
