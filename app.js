import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import compression from 'compression';
import helmet from 'helmet';

const app = express();

// 设置你的源站：在 Render 环境变量里配置
const target = process.env.TARGET_URL;           // 例如 https://your-origin.example.com 或 http://1.2.3.4:8080
const originHost = process.env.ORIGIN_HOST || ''; // 可选：需要自定义 Host 回源时用

if (!target) {
  console.error('❌ 缺少环境变量 TARGET_URL，例如 https://your-origin.example.com');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

app.use('/', createProxyMiddleware({
  target,
  changeOrigin: true,
  ws: true,
  secure: true,          // 如果源站是自签证书，改成 false
  xfwd: true,
  proxyTimeout: 30000,
  timeout: 30000,
  onProxyReq(proxyReq, req) {
    if (originHost) proxyReq.setHeader('Host', originHost);
    proxyReq.setHeader('X-Real-IP', req.ip);
  },
  onProxyRes(proxyRes) {
    delete proxyRes.headers['server'];
    delete proxyRes.headers['via'];
  }
}));

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`✅ Proxy listening on :${port} -> ${target}`);
});
