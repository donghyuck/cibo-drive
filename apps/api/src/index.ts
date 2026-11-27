import { createApp } from './app.js';

const enableLocalMcp = process.env.CIBO_ENABLE_LOCAL_MCP === 'true';
const port = Number(process.env.CIBO_API_PORT ?? 4000);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CIBO_API_PORT');
if (enableLocalMcp && process.env.NODE_ENV === 'production') throw new Error('MCP preview is local development only');

createApp({ enableLocalMcp }).listen(port, '127.0.0.1', () => {
  console.log(`Cibo API: http://127.0.0.1:${port}/healthz`);
  if (enableLocalMcp) console.log(`MCP preview (no file access): http://127.0.0.1:${port}/mcp`);
});
