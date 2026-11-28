import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { chromium } from 'playwright-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { driveRouter } from '../../apps/api/src/drive.ts';
import { tree } from '../../apps/api/src/drive-reads.ts';
import { digest } from './state.mjs';

export async function verifyApp(db, s3, bucket, manifest) {
  const app = express(),
    server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, client;
  try {
    app.use(
      '/api',
      driveRouter({
        origin,
        db,
        s3,
        bucket,
        clientId: 'rehearsal',
        masterSubject: '',
        verify: async () => {
          throw Error('Offline rehearsal');
        },
      }),
    );
    app.use(
      express.static(
        fileURLToPath(new URL('../../apps/web/out/', import.meta.url)),
      ),
    );
    const {
      rows: [user],
    } = await db.query(
      "SELECT a.acnt_idntfr,m.doc_space_idntfr FROM user_acnt a JOIN doc_space_acs_authrt m USING(acnt_idntfr) WHERE acnt_stts_cd='active' ORDER BY a.acnt_idntfr LIMIT 1",
    );
    assert.ok(
      user,
      'An active restored principal with space access is required',
    );
    // A fresh session in the disposable copy exercises the restored principal's
    // actual rights without enrolling another OAuth origin or copying a live cookie.
    const session = randomBytes(32).toString('hex');
    await db.query(
      "INSERT INTO lgn_ssn VALUES ($1,$2,now()+interval '10 minutes')",
      [createHash('sha256').update(session).digest('hex'), user.acnt_idntfr],
    );
    browser = await chromium.launch({ channel: 'chrome' });
    const page = await browser.newPage();
    await page.context().addCookies([
      {
        name: 'cibo_session',
        value: session,
        domain: '127.0.0.1',
        path: '/api',
        httpOnly: true,
        sameSite: 'Strict',
      },
    ]);
    await page.route('https://accounts.google.com/**', (r) => r.abort());
    await page.goto(origin);
    const btn = (name) => page.getByRole('button', { name, exact: true });
    await btn('MCP 연결').click();
    await page.getByLabel('연결 이름').fill('복원 연습');
    await btn('읽기 전용 토큰 발급').click();
    const token = await page.getByLabel(/발급된 토큰/).inputValue();
    client = new Client({ name: 'restore-rehearsal', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(origin + '/api/mcp'), {
        requestInit: { headers: { Authorization: 'Bearer ' + token } },
      }),
    );
    const read = async (name, args) => {
      const r = await client.callTool({ name, arguments: args });
      assert.ok(!r.isError);
      return JSON.parse(r.content[0].text);
    };
    const files = (
      await db.query(
        tree +
          ' SELECT artcl_idntfr id,artcl_nm name,ids FROM tree WHERE s3_objt_key IS NOT NULL',
        [user.doc_space_idntfr],
      )
    ).rows;
    assert.ok(files.length, 'At least one accessible document is required');
    let segments = 0,
      readable = 0;
    for (const file of files) {
      const expected = manifest.files.find((f) => f.id === file.id);
      assert.ok(expected);
      const meta = await read('get_file_metadata', { fileId: file.id });
      assert.equal(meta.name, file.name);
      assert.equal(new URL(meta.downloadUrl).origin, origin);
      // Navigate using the restored folder path, then download via the actual web UI.
      await page
        .getByRole('navigation', { name: '워크스페이스' })
        .getByRole('button', { name: '팀 문서 공간', exact: true })
        .click();
      await page
        .getByRole('heading', { name: meta.path[0], exact: true })
        .waitFor();
      for (let depth = 1; depth < meta.path.length - 1; depth++) {
        const name = meta.path[depth],
          count = files.filter((f) => f.ids.includes(file.ids[depth])).length;
        const item = page
          .locator('.items li > button')
          .filter({ has: page.locator('.filename').filter({ hasText: name }) });
        // Match the folder name exactly when sibling names overlap.
        const exact = item.filter({
          has: page.getByText(name, { exact: true }),
        });
        await exact
          .getByText('하위 포함 파일 ' + count + '개', { exact: true })
          .waitFor();
        await exact.click();
      }
      await btn(file.name + ' 미리보기').click();
      const download = page.waitForEvent('download');
      await page
        .getByRole('link', { name: '원본 다운로드', exact: true })
        .click();
      const d = await download;
      assert.equal(d.suggestedFilename().normalize(), file.name.normalize());
      assert.deepEqual(await digest(await d.createReadStream()), {
        size: expected.size,
        sha256: expected.sha256,
      });
      await btn('미리보기 닫기').click();
      const {
        rows: [source],
      } = await db.query(
        'SELECT prcs_stts_cd status,src_sctn_list chunks FROM doc_artcl_txt WHERE artcl_idntfr=$1',
        [file.id],
      );
      const collected = [];
      let offset = 0;
      do {
        const result = await read('read_file_text', {
          fileId: file.id,
          offset,
          limit: 10,
        });
        assert.equal(result.status, source.status);
        assert.equal(result.fileId, file.id);
        assert.equal(result.offset, offset);
        collected.push(...result.segments);
        assert.ok(result.nextOffset === null || result.nextOffset > offset);
        offset = result.nextOffset;
      } while (offset !== null);
      assert.deepEqual(collected, source.chunks);
      if (collected.length) {
        readable++;
        segments += collected.length;
      }
    }
    assert.ok(readable, 'No extracted text verified');
    assert.equal(
      (await fetch(origin + '/api/files/' + files[0].id)).status,
      401,
    );
    // Prove enforcement, then return the copy to its original ACL.
    await db.query(
      'DELETE FROM doc_space_acs_authrt WHERE acnt_idntfr=$1 AND doc_space_idntfr=$2',
      [user.acnt_idntfr, user.doc_space_idntfr],
    );
    try {
      assert.equal(
        (await page.request.get(origin + '/api/files/' + files[0].id)).status(),
        403,
      );
      await assert.rejects(
        client.callTool({
          name: 'read_file_text',
          arguments: { fileId: files[0].id },
        }),
        { code: 403 },
      );
    } finally {
      await db.query(
        'INSERT INTO doc_space_acs_authrt(acnt_idntfr,doc_space_idntfr) VALUES($1,$2)',
        [user.acnt_idntfr, user.doc_space_idntfr],
      );
    }
    assert.equal(
      (await read('get_file_metadata', { fileId: files[0].id })).fileId,
      files[0].id,
    );
    return {
      revokedWebAndMcp: 403,
      webDownloads: files.length,
      mcpFiles: files.length,
      mcpReadableFiles: readable,
      mcpSourceSegments: segments,
      anonymousDownload: 401,
    };
  } finally {
    await client?.close();
    await browser?.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
