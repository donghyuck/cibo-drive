import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export function createApp({ enableLocalMcp = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_, res) => res.json({ status: 'ok', service: 'cibo-api' }));

  if (enableLocalMcp) {
    const localhost = new Set(['localhost', '127.0.0.1', '[::1]']);
    app.all('/mcp', (req, res, next) => {
      const allowedHost = (value: string) => /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(value);
      let originHost: string | undefined;
      try { if (req.headers.origin) originHost = new URL(req.headers.origin).hostname; }
      catch { return res.sendStatus(403); }
      if (!allowedHost(req.headers.host ?? '') || (originHost && !localhost.has(originHost))) {
        return res.sendStatus(403);
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.sendStatus(405); }
      next();
    });
    app.post('/mcp', express.json({limit:'64kb'}), async (req, res, next) => {
      const server = new McpServer({ name: 'cibo-drive-local-preview', version: '0.1.0' });
      server.registerTool('cibo_preview_status', {
        description: 'Returns a local bootstrap status. This preview does not access users, files, or permissions.',
      }, async () => ({ content: [{ type: 'text', text: 'Cibo MCP 개발 미리보기. 파일 접근 기능 없음.' }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.once('close', () => { void server.close(); });
      try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) { next(error); }
    });
  }

  return app;
}
