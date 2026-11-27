import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from './app.js';

async function useApp(enabled: boolean, run: (base: URL) => Promise<void>) {
  const server = createApp({ enableLocalMcp: enabled }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try { await run(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)); }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

test('health is available and MCP is off by default', () => useApp(false, async base => {
  const health = await fetch(new URL('/healthz', base));
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'cibo-api' });
  const mcp = await fetch(new URL('/mcp', base), { method: 'POST' });
  assert.equal(mcp.status, 404);
}));

test('local MCP reports status without exposing file tools', () => useApp(true, async base => {
  const client = new Client({ name: 'bootstrap-test', version: '1.0.0' });
  const endpoint = new URL('/mcp', base);
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint));
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['cibo_preview_status']);
    const result = await client.callTool({ name: 'cibo_preview_status' });
    assert.match(JSON.stringify(result), /파일 접근 기능 없음/);
  } finally { await client.close(); }
  assert.equal((await fetch(endpoint, { method:'POST', headers:{origin:'https://example.com'} })).status, 403);
}));
