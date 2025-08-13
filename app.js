// app.js —— Node 反代中转（适配 Zeabur / 微信内访问）
// 必须用 Node 18 或 20 运行
const http = require('http');

const TARGET = process.env.TARGET || 'https://care.yipuwh.com'; // 改成你的源站
const PORT = process.env.PORT || 3000;

http.createServer(async (req, res) => {
  try {
    const proto = ((req.headers['x-forwarded-proto'] || 'https') + '').split(',')[0].trim();
    const host  = req.headers.host;
    const incoming = new URL(`${proto}://${host}${req.url}`);

    // 健康检查
    if (incoming.pathname === '/_health') {
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return;
    }

    // CORS 预检（可要可不要）
    if (req.method === 'OPTIONS') {
      writeHead(res, 204, {}, corsHeaders(req)); res.end(''); return;
    }

    // 目标地址：把 host 改到 TARGET
    const t = new URL(TARGET);
    const upstream = new URL(incoming.toString());
    upstream.protocol = t.protocol; upstream.host = t.host;

    // 收集请求体
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const body = (req.method === 'GET' || req.method === 'HEAD') ? undefined : Buffer.concat(chunks);

      // 透传请求头
      const headers = { ...req.headers };
      delete headers['host']; delete headers['content-length'];

      // Node 18/20 自带 fetch
      const upRes = await fetch(upstream.toString(), {
        method: req.method, headers, body, redirect: 'manual',
      });

      // 处理 30x 跳转：把 Location 指回当前域名
      if (upRes.status >= 300 && upRes.status < 400) {
        const h = cloneHeaders(upRes.headers);
        const loc = upRes.headers.get('location');
        if (loc) h['location'] = rewriteLocation(loc, incoming, TARGET);
        normalizeHtmlInline(h); addSecurity(h); Object.assign(h, corsHeaders(req));
        writeHead(res, upRes.status, h); res.end(''); return;
      }

      const h = cloneHeaders(upRes.headers);
      addSecurity(h); Object.assign(h, corsHeaders(req));

      const ct = (upRes.headers.get('content-type') || '').toLowerCase();
      if (ct.includes('text/html')) {
        // 明确就是 HTML
        const html = await upRes.text();
        normalizeHtmlInline(h);
        h['content-length'] = Buffer.byteLength(html).toString();
        writeHead(res, upRes.status, h); res.end(html); return;
      }

      // 兜底：上游误标为下载/二进制但内容像 HTML
      const buf = Buffer.from(await upRes.arrayBuffer());
      if (looksLikeHtml(buf)) {
        const html = buf.toString('utf8');
        normalizeHtmlInline(h);
        h['content-length'] = Buffer.byteLength(html).toString();
        writeHead(res, upRes.status, h); res.end(html); return;
      }

      // 其他资源：二进制透传
      writeHead(res, upRes.status, h); res.end(buf);
    });
  } catch (e) {
    console.error('proxy error:', e?.stack || e?.message || e);
    writeHead(res, 502, { 'content-type': 'text/plain' }); res.end('proxy error');
  }
}).listen(PORT, () => console.log('server on', PORT));

// ---------- helpers ----------
function cloneHeaders(h){ const o={}; for (const [k,v] of h.entries()) o[k.toLowerCase()] = v; return o; }
function writeHead(res, code, headers={}, extra={}){ res.writeHead(code, { ...headers, ...extra }); }
function corsHeaders(req){
  const origin = req.headers.origin || '*';
  return {
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
    'Access-Control-Max-Age': '86400',
  };
}
function addSecurity(h){
  h['strict-transport-security'] = 'max-age=31536000; includeSubDomains; preload';
  h['x-content-type-options'] = 'nosniff';
  h['referrer-policy'] = 'strict-origin-when-cross-origin';
}
function normalizeHtmlInline(h){
  delete h['content-disposition']; delete h['Content-Disposition'];
  delete h['content-type']; delete h['Content-Type'];
  delete h['content-transfer-encoding']; delete h['Content-Transfer-Encoding'];
  h['content-disposition'] = 'inline';
  h['content-type'] = 'text/html; charset=utf-8';
}
function rewriteLocation(loc, incoming, target){
  try { const u = new URL(loc, incoming); u.protocol = 'https:'; const th = new URL(target).host;
        if (u.host === th) u.host = incoming.host; return u.toString(); } catch { return loc; }
}
function looksLikeHtml(buf){
  const head = buf.slice(0, 2048).toString('utf8').trimStart().slice(0, 200);
  return head.startsWith('<!DOCTYPE html') || head.startsWith('<!doctype html') || head.startsWith('<html') || /^<\w+/.test(head);
}
