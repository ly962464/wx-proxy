import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import compression from 'compression';
import helmet from 'helmet';

const app = express();

// 必填：目标地址（你的国内源站，含协议和端口）
// 部署到 Render 时在环境变量里设置：TARGET_URL
const target = process.env.TARGET_URL; 
if (!target) {
  console.error('❌ 请设置环境变量 TARGET_URL，例如 https://your-origin.example.com');
  process.exit(1);
}

// 常用优化
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: false, // 视情况开启
}));
app.use(compression());

// 反代中间件
app.use('/', createProxyMiddleware({
  target,
  changeOrigin: true,                 // 修改 Host 头为目标域名
  ws: true,                           // 支持 WebSocket
  secure: true,                       // 如果目标是自签证书，可改为 false
  xfwd: true,                         // 透传 X-Forwarded-* 头
  proxyTimeout: 30_000,               // 回源超时
  timeout: 30_000,
  onProxyReq: (proxyReq, req, res) => {
    // 手动设置回源 Host，必要时保留你源站域名
    const hostHeader = process.env.ORIGIN_HOST; // 可选：如需指定源站Host
    if (hostHeader) proxyReq.setHeader('Host', hostHeader);

    // 透传真实IP
    proxyReq.setHeader('X-Real-IP', req.ip);
  },
  onProxyRes: (proxyRes) => {
    // 去掉可能暴露源站的头
    delete proxyRes.headers['server'];
    delete proxyRes.headers['via'];
  }
}));

const port = process.env.PORT || 10000; // Render 会注入 PORT
app.listen(port, () => {
  console.log(`✅ Proxy running on :${port} -> ${target}`);
});
