'use strict';
// 本地 HTTPS 静态服务器：让 PWA 在电脑和手机（局域网）上以安全上下文运行
// 用法：node server.js [端口]  默认 8443
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.argv[2]) || 8443;
const ROOT = __dirname;

const certDir = path.join(ROOT, '.cert');
const hasCert = fs.existsSync(path.join(certDir, 'cert.pem')) && fs.existsSync(path.join(certDir, 'key.pem'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json'
};

function handler(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

if (hasCert) {
  const opts = {
    key: fs.readFileSync(path.join(certDir, 'key.pem')),
    cert: fs.readFileSync(path.join(certDir, 'cert.pem'))
  };
  https.createServer(opts, handler).listen(PORT, '0.0.0.0', () => {
    console.log(`HTTPS 服务已启动: https://localhost:${PORT}`);
  });
} else {
  // 无证书时退回 HTTP（仅本机可用，PWA 功能受限）
  http.createServer(handler).listen(PORT, '127.0.0.1', () => {
    console.log(`HTTP 服务已启动（无证书）: http://localhost:${PORT}`);
  });
}
