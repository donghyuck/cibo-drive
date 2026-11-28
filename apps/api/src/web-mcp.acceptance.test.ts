// Exercise file links and evidence search through the web UI and MCP transport.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import express from 'express';
import pg from 'pg';
import { chromium, type Page } from 'playwright-core';
import {
  GetObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { driveRouter } from './drive.js';
import { migrate } from './database.js';
import { embeddingProvider, indexNext } from './embeddings.js';
import { extractNext } from './document-text.js';

test(
  'existing web links and the same MCP client follow file changes and current permissions',
  { timeout: 120000 },
  async (t) => {
    const env = process.env;
    assert.ok(
      env.DATABASE_URL &&
        env.S3_ENDPOINT &&
        env.S3_BUCKET &&
        env.S3_ACCESS_KEY_ID &&
        env.S3_SECRET_ACCESS_KEY,
    );
    const schema = 'accept_' + randomUUID().replaceAll('-', '');
    const adminDb = new pg.Pool({ connectionString: env.DATABASE_URL });
    await adminDb.query('CREATE SCHEMA ' + schema);
    const db = new pg.Pool({
      connectionString: env.DATABASE_URL,
      options: '-c search_path=' + schema,
    });
    const s3 = new S3Client({
      region: env.S3_REGION ?? 'us-east-1',
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
    const bucket = env.S3_BUCKET;
    t.after(async () => {
      try {
        if (
          (
            await db.query(
              "SELECT to_regclass(current_schema()||'.doc_artcl') AS rel",
            )
          ).rows[0].rel
        ) {
          for (const { key } of (
            await db.query(
              'SELECT s3_objt_key AS key FROM doc_artcl WHERE s3_objt_key IS NOT NULL',
            )
          ).rows)
            await s3.send(
              new DeleteObjectCommand({ Bucket: bucket, Key: key }),
            );
        }
      } finally {
        await db.end();
        await adminDb.query('DROP SCHEMA ' + schema + ' CASCADE');
        await adminDb.end();
        s3.destroy();
      }
    });
    await migrate(db);
    const app = express(),
      server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
          server.closeAllConnections();
        }),
    );
    const origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    const embeddings = embeddingProvider({
      ...env,
      CIBO_EMBED_MODEL: env.CIBO_ACCEPTANCE_EMBED_MODEL,
    }) ?? {
      model: 'acceptance@2',
      embed: async (texts: string[]) => texts.map((text) => [text.length, 1]),
    };
    app.use(
      '/api',
      driveRouter({
        origin,
        db,
        s3,
        bucket,
        embeddings,
        clientId: 'fixture',
        masterSubject: 'owner',
        verify: async (credential) => {
          if (!['owner', 'editor'].includes(credential))
            throw Error('Unknown fixture identity');
          return {
            subject: credential,
            email: credential + '@example.invalid',
          };
        },
      }),
    );
    app.use(
      express.static(fileURLToPath(new URL('../../web/out/', import.meta.url))),
    );
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
    });
    t.after(() => browser.close());
    const login = async (subject: string) => {
      const ctx = await browser.newContext();
      const response = await ctx.request.post(origin + '/api/login', {
        headers: { Origin: origin },
        data: { credential: subject },
      });
      assert.equal(response.status(), 204);
      // The session cookie is real. Keep external Google scripts out of the fixture.
      await ctx.route('https://accounts.google.com/**', (route) =>
        route.abort(),
      );
      const p = await ctx.newPage();
      p.setDefaultTimeout(8000);
      await p.goto(origin);
      return p;
    };
    const owner = await login('owner'),
      editor = await login('editor');
    const button = (p: Page, name: string) =>
      p.getByRole('button', { name, exact: true });
    await button(owner, '계정 관리').click();
    const form = owner
      .locator('form')
      .filter({ hasText: 'editor@example.invalid' });
    async function setAccess(status: string, access: boolean) {
      await form.getByLabel('상태').selectOption(status);
      await form.getByLabel('역할').selectOption('editor');
      await form.getByLabel('공간 접근').setChecked(access);
      const [response] = await Promise.all([
        owner.waitForResponse(
          (r) =>
            r.url().includes('/api/admin/accounts/') &&
            r.request().method() === 'POST',
        ),
        form.getByRole('button', { name: '저장' }).click(),
      ]);
      assert.equal(response.status(), 204);
    }
    await setAccess('active', true);
    await editor.reload();
    const existing = '기존 파일.txt',
      renamed = '변경된 파일.txt',
      destination = '보관 폴더',
      bytes = Buffer.from('인수시험 본문과 출처');
    await editor
      .getByLabel('업로드할 파일')
      .setInputFiles({ name: existing, mimeType: 'text/plain', buffer: bytes });
    await button(editor, existing + ' 미리보기').waitFor();
    await extractNext(
      db,
      async (key) =>
        (await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key })))
          .Body as Readable,
    );
    assert.equal(await indexNext(db, embeddings), true);
    await button(editor, '새 폴더').click();
    await editor.getByLabel('폴더 이름').fill(destination);
    await button(editor, '만들기').click();
    await button(editor, 'MCP 연결').click();
    await editor.getByLabel('연결 이름').fill('인수시험');
    await button(editor, '읽기 전용 토큰 발급').click();
    const token = await editor.getByLabel(/발급된 토큰/).inputValue();
    const mcp = new Client({ name: 'acceptance-client', version: '1' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(origin + '/api/mcp'), {
        requestInit: { headers: { Authorization: 'Bearer ' + token } },
        fetch: async (url, init) => {
          const response = await fetch(url, init);
          if (response.status === 403)
            assert.equal(await response.clone().text(), 'Forbidden');
          return response;
        },
      }),
    );
    t.after(() => mcp.close());
    const call = (name: string, args: Record<string, unknown> = {}) =>
      mcp.callTool({ name, arguments: args });
    const read = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await call(name, args);
      assert.ok(!result.isError);
      return JSON.parse((result.content as { text: string }[])[0].text);
    };
    const original = (await read('search_files', { query: existing }))
      .entries[0];
    const id = original.id,
      meta = await read('get_file_metadata', { fileId: id });
    const root = (await read('list_folder')).entries;
    const folderId = root.find(
      (i: { name: string }) => i.name === destination,
    ).id;
    const question = { question: '인수시험에서 무엇을 확인하나요?' };
    const search = () => read('search_passages', question);
    const initial = await search();
    assert.equal(initial.results.length, 1);
    const [hit] = initial.results;
    assert.equal(hit.fileId, id);
    assert.equal(hit.name, existing);
    assert.deepEqual(
      [hit.unit, hit.start, hit.end, hit.text],
      ['line', 1, 1, bytes.toString()],
    );
    assert.equal(hit.downloadUrl, meta.downloadUrl);
    const link = hit.downloadUrl,
      preview = link + '/preview',
      text = link + '/text';
    const get = (url: string, range = false) =>
      editor.request.get(url, { headers: range ? { Range: 'bytes=0-2' } : {} });
    async function indexState() {
      return (
        await db.query(
          `SELECT t.idx_stts_cd, t.idx_mdl_nm, t.srch_sctn_list, i.sctn_sn, i.emb_vctr
         FROM doc_artcl_txt t JOIN doc_sctn_idx i USING (artcl_idntfr)
         WHERE t.artcl_idntfr=$1 ORDER BY i.sctn_sn`,
          [id],
        )
      ).rows;
    }
    const indexed = await indexState();
    assert.equal(indexed.length, 1);
    assert.equal(indexed[0].idx_stts_cd, 'ready');
    assert.equal(indexed[0].idx_mdl_nm, embeddings.model);
    assert.ok(indexed[0].emb_vctr.length > 0);
    async function accessible(expectedName = renamed) {
      const { results } = await search();
      assert.equal(results.length, 1);
      assert.deepEqual(
        [
          results[0].fileId,
          results[0].name,
          results[0].text,
          results[0].downloadUrl,
        ],
        [id, expectedName, bytes.toString(), link],
      );
      const original = await get(link);
      assert.equal(original.status(), 200);
      assert.deepEqual(await original.body(), bytes);
      assert.equal((await get(preview, true)).status(), 206);
      const viaWeb = await (await get(text)).json();
      assert.deepEqual(viaWeb.segments, [
        { start: 1, end: 1, unit: 'line', text: bytes.toString() },
      ]);
      assert.deepEqual(
        (await read('read_file_text', { fileId: id })).segments,
        viaWeb.segments,
      );
    }
    async function blockedLinks(status: number) {
      assert.deepEqual(await indexState(), indexed);
      for (const response of await Promise.all([
        get(link),
        get(preview, true),
        get(text),
      ])) {
        assert.equal(response.status(), status);
        assert.equal(response.headers()['content-disposition'], undefined);
        assert.deepEqual(await response.json(), {
          error:
            status === 404
              ? '파일을 찾을 수 없습니다.'
              : '문서 공간 권한이 필요합니다.',
        });
      }
    }
    const webSearch = () =>
      editor.request.post(origin + '/api/search/passages', {
        headers: { Origin: origin },
        data: question,
      });
    async function blockedAccount() {
      assert.equal((await webSearch()).status(), 403);
      await blockedLinks(403);
      for (const [name, args] of [
        ['search_passages', question],
        ['list_folder', { folderId }],
        ['search_files', { query: renamed }],
        ['get_file_metadata', { fileId: id }],
        ['read_file_text', { fileId: id }],
      ] as const)
        await assert.rejects(call(name, args), { code: 403 });
      for (const path of [
        'folder?id=' + folderId,
        'search?q=' + encodeURIComponent(renamed),
      ])
        assert.equal((await get(origin + '/api/' + path)).status(), 403);
    }
    await accessible(existing);
    await button(editor, '팀 문서 공간').click();
    await button(editor, '질문 검색').click();
    const evidenceDialog = editor.getByRole('dialog', {
      name: '질문으로 검색',
    });
    await evidenceDialog
      .getByLabel('내 문서에 질문하기')
      .fill(question.question);
    await evidenceDialog
      .getByRole('button', { name: '검색', exact: true })
      .click();
    await evidenceDialog
      .getByRole('button', { name: new RegExp(existing) })
      .click();
    const cited = editor.getByRole('dialog', { name: existing });
    await cited.getByText('1줄', { exact: true }).waitFor();
    await cited.getByText(bytes.toString(), { exact: true }).waitFor();
    await button(editor, '미리보기 닫기').click();
    await evidenceDialog.getByRole('button', { name: '검색 닫기' }).click();
    await button(editor, existing + ' 관리').click();
    await editor.getByLabel('새 이름').fill(renamed);
    await editor.getByRole('dialog').locator('footer button.primary').click();
    await button(editor, renamed + ' 미리보기').waitFor();
    assert.deepEqual(
      (await read('search_files', { query: existing })).entries,
      [],
    );
    assert.equal(
      (await read('search_files', { query: renamed })).entries[0].id,
      id,
    );
    await button(editor, renamed + ' 폴더로 이동').click();
    await editor.getByLabel('대상 폴더').selectOption(folderId);
    await editor.getByRole('dialog').locator('footer button.primary').click();
    await button(editor, renamed + ' 미리보기').waitFor({ state: 'hidden' });
    assert.equal(
      (await read('list_folder')).entries.some(
        (e: { id: string }) => e.id === id,
      ),
      false,
    );
    assert.equal((await read('list_folder', { folderId })).entries[0].id, id);
    const after = await read('get_file_metadata', { fileId: id });
    assert.deepEqual(after.path, ['팀 문서 공간', destination, renamed]);
    assert.equal(after.downloadUrl, link);
    await editor
      .locator('.items li > button')
      .filter({ hasText: destination })
      .click();
    await button(editor, renamed + ' 미리보기').click();
    await editor
      .getByRole('dialog')
      .getByText(bytes.toString(), { exact: true })
      .waitFor();
    await button(editor, '미리보기 닫기').click();
    await accessible();
    await button(editor, renamed + ' 관리').click();
    await editor
      .getByRole('dialog')
      .getByRole('button', { name: '휴지통', exact: true })
      .click();
    await button(editor, '휴지통으로 이동').click();
    await button(editor, renamed + ' 미리보기').waitFor({ state: 'hidden' });
    assert.deepEqual(await (await webSearch()).json(), { results: [] });
    const hidden = await call('search_passages', question);
    assert.ok(!hidden.isError);
    assert.deepEqual(hidden.content, [
      { type: 'text', text: JSON.stringify({ results: [] }) },
    ]);
    assert.equal(hidden.structuredContent, undefined);
    await blockedLinks(404);
    assert.deepEqual((await read('list_folder', { folderId })).entries, []);
    assert.deepEqual(
      (await read('search_files', { query: renamed })).entries,
      [],
    );
    for (const name of ['get_file_metadata', 'read_file_text'])
      assert.equal((await call(name, { fileId: id })).isError, true);
    await button(editor, '휴지통').click();
    await button(editor, renamed + ' 복원').click();
    await editor
      .getByRole('dialog', { name: '휴지통에서 복원' })
      .getByRole('button', { name: '복원', exact: true })
      .click();
    await editor.getByText('휴지통이 비어 있습니다.').waitFor();
    await accessible();
    await setAccess('active', false);
    await blockedAccount();
    await setAccess('active', true);
    await accessible();
    await setAccess('suspended', true);
    await blockedAccount();
  },
);
