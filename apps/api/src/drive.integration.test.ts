import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import assert from 'node:assert/strict';
import { extractNext, thumbnailNext } from './document-text.js';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import express from 'express';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { driveRouter, type Settings } from './drive.js';
import { migrate } from './database.js';

test('team approval, space access and original file lifecycle', async (t) => {
  const env = process.env;
  assert.ok(
    env.DATABASE_URL &&
      env.S3_ENDPOINT &&
      env.S3_BUCKET &&
      env.S3_ACCESS_KEY_ID &&
      env.S3_SECRET_ACCESS_KEY,
  );
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const setup = new pg.Pool({ connectionString: env.DATABASE_URL });
  await setup.query('CREATE SCHEMA ' + schema);
  const db = new pg.Pool({
    connectionString: env.DATABASE_URL,
    options: '-c search_path=' + schema,
  });
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  t.after(async () => {
    try {
      for (const { object_key } of (
        await db.query(
          'SELECT s3_objt_key AS object_key FROM doc_artcl WHERE s3_objt_key IS NOT NULL',
        )
      ).rows) {
        await s3.send(
          new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: object_key }),
        );
      }
    } finally {
      await db.end();
      await setup.query('DROP SCHEMA ' + schema + ' CASCADE');
      await setup.end();
      s3.destroy();
    }
  });
  await Promise.all([migrate(db), migrate(db)]);
  assert.equal(
    (await db.query('SELECT count(*) FROM doc_artcl')).rows[0].count,
    '1',
  );
  const app = express();
  const origin = 'http://127.0.0.1:3000';
  const settings: Settings = {
    db,
    s3,
    bucket: env.S3_BUCKET,
    origin,
    clientId: 'test',
    masterSubject: 'master',
    verify: async (credential) => {
      if (!['master', 'member'].includes(credential)) throw new Error();
      return { subject: credential, email: credential + '@example.com' };
    },
  };
  app.use('/api/bootstrap', driveRouter({ ...settings, masterSubject: '' }));
  app.use('/api', driveRouter(settings));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  );
  const base =
    'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/';
  const request = (path: string, cookie = '', init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: { cookie, origin, ...init.headers },
    });
  const post = (path: string, cookie: string, body: unknown) =>
    request(path, cookie, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  async function login(credential: string, path = 'login') {
    const res = await post(path, '', { credential });
    assert.equal(res.status, 204);
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  const initial = await login('master', 'bootstrap/login');
  const pendingMaster = await (await request('me', initial)).json();
  assert.equal(pendingMaster.status, 'pending');
  assert.equal(pendingMaster.role, 'viewer');
  assert.equal((await request('admin/accounts', initial)).status, 403);
  const master = await login('master');
  const activated = await (await request('me', master)).json();
  assert.equal(activated.id, pendingMaster.id);
  assert.equal(activated.status, 'active');
  assert.equal(activated.role, 'admin');
  assert.equal(
    (
      await db.query('SELECT oidc_issuer FROM user_acnt WHERE acnt_idntfr=$1', [
        activated.id,
      ])
    ).rows[0].oidc_issuer,
    'https://accounts.google.com',
  );
  const member = await login('member');
  const me = await (await request('me', member)).json();
  assert.equal(me.status, 'pending');
  assert.equal(
    (await (await request('me', await login('member'))).json()).id,
    me.id,
  );
  assert.equal((await request('folder', master)).status, 403);
  assert.equal((await request('folder', member)).status, 403);
  assert.equal((await request('admin/accounts', member)).status, 403);
  assert.equal(
    (await post('login', '', { credential: 'invalid' })).status,
    401,
  );
  assert.equal(
    (await post('mcp-tokens', member, { name: 'pending' })).status,
    403,
  );
  const grant = async (status: string, role: string, access: boolean) =>
    assert.equal(
      (await post('admin/accounts/' + me.id, master, { status, role, access }))
        .status,
      204,
    );
  await grant('active', 'editor', true);
  const issue = await post('mcp-tokens', member, {
    name: 'Integration client',
  });
  assert.equal(issue.status, 201);
  const issued = await issue.json();
  const mcpEndpoint = new URL('mcp', base);
  const headers = { Authorization: 'Bearer ' + issued.token };
  const mcpStatus = async (extra: Record<string, string> = {}) =>
    (
      await fetch(mcpEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...extra },
        body: '{}',
      })
    ).status;
  assert.equal(await mcpStatus(), 401);
  assert.equal(await mcpStatus({ cookie: member }), 401);
  assert.equal(
    await mcpStatus({
      Authorization:
        'Bearer eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJhY2NvdW50cy5nb29nbGUuY29tIn0.signature',
    }),
    401,
  );
  assert.equal(
    await mcpStatus({ ...headers, origin: 'https://elsewhere.example' }),
    403,
  );
  assert.equal((await request('me', '', { headers })).status, 401);
  assert.equal(
    (await request('mcp-tokens/' + issued.id, master, { method: 'DELETE' }))
      .status,
    404,
  );
  const listed = await (await request('mcp-tokens', member)).json();
  assert.equal(listed[0].id, issued.id);
  assert.ok(!JSON.stringify(listed).includes(issued.token));
  const client = new Client({ name: 'drive-mcp-test', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(mcpEndpoint, {
      requestInit: { headers },
    }),
  );
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
    'get_file_metadata',
    'list_folder',
    'read_file_text',
    'search_files',
  ]);
  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });
  const readTool = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await call(name, args);
    assert.ok(!result.isError);
    return JSON.parse((result.content as { text: string }[])[0].text);
  };
  const root = (await (await request('folder', member)).json()).current.id;
  const parent = (
    await (await post('folders', member, { parent: root, name: '팀' })).json()
  ).id;
  const child = (
    await (await post('folders', member, { parent, name: '자료' })).json()
  ).id;
  const upload = (name: string, body: string) =>
    request('files?' + new URLSearchParams({ parent: child, name }), member, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });
  assert.equal((await upload('invalid.exe', 'sample')).status, 400);
  assert.equal(
    (await upload('large.txt', 'x'.repeat(30 * 1024 * 1024 + 1))).status,
    413,
  );
  s3.middlewareStack.add(
    () => async () => {
      throw new Error('Simulated storage failure');
    },
    {
      step: 'initialize',
      name: 'simulateStorageFailure',
    },
  );
  try {
    assert.equal((await upload('저장실패.txt', 'sample')).status, 500);
  } finally {
    s3.middlewareStack.remove('simulateStorageFailure');
  }
  assert.deepEqual(
    (await (await request('folder?id=' + child, member)).json()).entries,
    [],
  );
  const data = '첫 문서\n';
  const saved = await upload('회의록.md', data);
  assert.equal(saved.status, 201);
  const { id } = await saved.json();
  const extractOne = () =>
    extractNext(db, async (key) => {
      const object = await s3.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      );
      return object.Body as Readable;
    });
  const textUrl = 'files/' + id + '/text';
  assert.equal((await request(textUrl, member)).status, 202);
  assert.deepEqual((await Promise.all([extractOne(), extractOne()])).sort(), [
    false,
    true,
  ]);
  const firstText = await (await request(textUrl, member)).json();
  assert.equal(firstText.status, 'ready');
  assert.deepEqual(firstText.segments, [
    { unit: 'line', start: 1, end: 1, text: '첫 문서' },
  ]);
  assert.equal((await upload('회의록.md', '다른 내용')).status, 409);
  const entries = (await (await request('folder?id=' + child, member)).json())
    .entries;
  assert.equal(entries.length, 1);
  const registered = entries[0].registered_at;
  assert.ok(Number.isFinite(Date.parse(registered)));
  assert.deepEqual(entries[0], {
    id,
    name: '회의록.md',
    folder: false,
    size: Buffer.byteLength(data),
    registered_at: registered,
    thumbnail: { image: false, pending: true, excerpt: null },
  });
  const key = (
    await db.query(
      'SELECT s3_objt_key AS object_key FROM doc_artcl WHERE artcl_idntfr=$1',
      [id],
    )
  ).rows[0].object_key;
  assert.equal((await readTool('list_folder')).folder.id, root);
  assert.equal(
    (await readTool('list_folder', { folderId: child })).entries[0].id,
    id,
  );
  assert.equal(
    (await readTool('get_file_metadata', { fileId: id })).size,
    Buffer.byteLength(data),
  );
  assert.deepEqual(
    (await readTool('read_file_text', { fileId: id })).segments,
    firstText.segments,
  );
  const anonymous = await fetch(
    env.S3_ENDPOINT + '/' + env.S3_BUCKET + '/' + key,
  );
  // Private S3 implementations can deny access or conceal object existence.
  assert.ok(
    [403, 404].includes(anonymous.status),
    'anonymous object read must be denied',
  );
  const download = 'files/' + id;
  assert.equal(await (await request(download, member)).text(), data);
  assert.equal((await request(download, master)).status, 403);
  await grant('pending', 'editor', true);
  assert.equal((await request(download, member)).status, 403);
  await grant('active', 'viewer', true);
  assert.equal((await post('folders', member, { name: '차단' })).status, 403);
  assert.equal((await upload('차단.txt', 'x')).status, 403);
  assert.equal(await (await request(download, member)).text(), data);
  const preview = download + '/preview';
  let reads = 0;
  s3.middlewareStack.add(
    (next, context) => async (args) => {
      if (context.commandName === 'GetObjectCommand') reads++;
      return next(args);
    },
    { step: 'initialize', name: 'countPreviewReads' },
  );
  try {
    const [head, first, tail] = await Promise.all([
      request(preview, member, { method: 'HEAD' }),
      request(preview, member, { headers: { Range: 'bytes=0-2' } }),
      request(preview, member, { headers: { Range: 'bytes=-1' } }),
    ]);
    assert.equal(head.status, 200);
    assert.equal(first.status, 206);
    assert.equal(
      first.headers.get('content-range'),
      'bytes 0-2/' + Buffer.byteLength(data),
    );
    assert.equal(await first.text(), '첫');
    assert.equal(await tail.text(), '\n');
    assert.equal(await (await request(preview, member)).text(), data);
    assert.equal(
      (await request(preview, member, { headers: { Range: 'bytes=999-' } }))
        .status,
      416,
    );
    assert.equal(reads, 1);
  } finally {
    s3.middlewareStack.remove('countPreviewReads');
  }
  const change = (target: string, action: string, body: object = {}) =>
    post('entries/' + target + '/' + action, member, body);
  const search = async (q: string) =>
    (await request('search?' + new URLSearchParams({ q }), member)).json();
  const folderRows = async (parentId: string) =>
    (await (await request('folder?id=' + parentId, member)).json()).entries;
  for (const action of ['rename', 'move', 'trash', 'restore'])
    assert.equal((await change(id, action)).status, 403);
  assert.equal((await request('trash', member)).status, 403);
  await grant('active', 'editor', true);
  assert.equal((await change(root, 'trash')).status, 400);
  assert.equal((await change(parent, 'move', { parent: child })).status, 400);
  assert.equal((await change(child, 'move', { parent: child })).status, 400);
  assert.equal((await change(id, 'rename', { name: '파일.pdf' })).status, 400);
  assert.equal(
    (await change(id, 'rename', { name: 'Report_100%.md' })).status,
    204,
  );
  assert.deepEqual(await search('회의록'), []);
  assert.equal((await search('report_100%'))[0].id, id);
  assert.equal(
    (await change(id, 'move', { parent, expectedParent: root })).status,
    409,
  );
  assert.equal(
    (await change(id, 'move', { parent, expectedParent: child })).status,
    204,
  );
  assert.equal((await folderRows(child)).length, 0);
  assert.equal(
    (await folderRows(parent)).find((x: { id: string }) => x.id === id)
      .registered_at,
    registered,
  );
  assert.ok(
    (await folderRows(parent)).some((x: { id: string }) => x.id === id),
  );
  assert.deepEqual((await search('100%'))[0].location, ['팀 문서 공간', '팀']);
  assert.deepEqual(
    (await readTool('search_files', { query: '회의록' })).entries,
    [],
  );
  const moved = (
    await readTool('search_files', { query: 'report', folderId: parent })
  ).entries[0];
  assert.equal(moved.id, id);
  assert.deepEqual(moved.location, ['팀 문서 공간', '팀']);
  assert.equal(
    (await readTool('get_file_metadata', { fileId: id })).name,
    'Report_100%.md',
  );
  assert.equal((await change(child, 'trash')).status, 204);
  assert.equal((await change(parent, 'trash')).status, 204);
  assert.equal((await request(textUrl, member)).status, 404);
  for (const name of ['get_file_metadata', 'read_file_text'])
    assert.equal((await call(name, { fileId: id })).isError, true);
  assert.deepEqual(
    (await readTool('search_files', { query: 'report' })).entries,
    [],
  );
  assert.deepEqual(await search('Report'), []);
  assert.deepEqual(await folderRows(root), []);
  assert.equal((await request(download, member)).status, 404);
  assert.equal(
    (await request(preview, member, { headers: { Range: 'bytes=0-2' } }))
      .status,
    404,
  );
  assert.equal(
    (await post('folders', member, { parent, name: '숨은 폴더' })).status,
    404,
  );
  assert.equal((await change(child, 'restore')).status, 409);
  const trash = await (await request('trash', member)).json();
  assert.deepEqual(
    trash.map((x: { id: string }) => x.id).sort(),
    [child, parent].sort(),
  );
  const replacement = await post('folders', member, {
    parent: root,
    name: '팀',
  });
  assert.equal(replacement.status, 201);
  assert.equal((await change(parent, 'restore')).status, 409);
  assert.equal(
    (await change(parent, 'restore', { name: '복원된 팀' })).status,
    204,
  );
  assert.equal((await request('folder?id=' + child, member)).status, 404);
  assert.equal((await change(child, 'restore')).status, 204);
  assert.deepEqual((await search('Report'))[0].location, [
    '팀 문서 공간',
    '복원된 팀',
  ]);
  assert.equal(await (await request(download, member)).text(), data);
  assert.equal(await (await request(preview, member)).text(), data);
  assert.equal(
    (
      await db.query(
        'SELECT s3_objt_key FROM doc_artcl WHERE artcl_idntfr=$1',
        [id],
      )
    ).rows[0].s3_objt_key,
    key,
  );
  const sibling = (await replacement.json()).id;
  const moves = await Promise.all([
    change(sibling, 'move', { parent }),
    change(parent, 'move', { parent: sibling }),
  ]);
  assert.deepEqual(moves.map((r) => r.status).sort(), [204, 400]);
  for (const [name, bytes, expected] of [
    ['empty.txt', '   ', 'empty'],
    ['invalid.pdf', 'not a PDF', 'failed'],
  ]) {
    const uploaded = await upload(name, bytes);
    assert.equal(uploaded.status, 201);
    const file = 'files/' + (await uploaded.json()).id;
    assert.equal(await extractOne(), true);
    const result = await (await request(file + '/text', member)).json();
    assert.equal(result.status, expected);
    assert.equal(await (await request(file, member)).text(), bytes);
    if (expected === 'failed') {
      assert.ok(result.reason);
      assert.equal((await post(file + '/text/retry', member, {})).status, 204);
      assert.equal((await request(file + '/text', member)).status, 202);
      await extractOne();
    }
  }
  assert.equal(
    (await (await request(textUrl, member)).json()).name,
    'Report_100%.md',
  );
  const epub = await (
    await import('node:fs/promises')
  ).readFile(new URL('../fixtures/sample.epub', import.meta.url));
  const book = await request(
    'files?' + new URLSearchParams({ parent: child, name: 'sample.EPUB' }),
    member,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: new Uint8Array(epub),
    },
  );
  assert.equal(book.status, 201);
  const bookId = (await book.json()).id;
  const bookPath = 'files/' + bookId;
  assert.deepEqual(
    Buffer.from(await (await request(bookPath, member)).arrayBuffer()),
    epub,
  );
  assert.equal(await extractOne(), true);
  const contents = await (await request(bookPath + '/chapters', member)).json();
  assert.equal(contents.status, 'ready');
  assert.deepEqual(
    contents.chapters.map((c: { title: string }) => c.title),
    ['Sample', 'Part Two', 'Part Three'],
  );
  assert.deepEqual(
    (await readTool('get_file_metadata', { fileId: bookId })).chapters,
    contents.chapters,
  );
  const bookText = await readTool('read_file_text', {
    fileId: bookId,
    offset: contents.chapters[1].offset,
    limit: 1,
  });
  assert.deepEqual(bookText.segments, [
    {
      unit: 'chapter',
      start: 2,
      end: 2,
      chapterTitle: 'Part Two',
      href: 'page.xhtml#end',
      text: 'Second chapter',
    },
  ]);
  while (
    await thumbnailNext(
      db,
      async (key) =>
        (
          await s3.send(
            new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
          )
        ).Body as Readable,
    )
  ) {}
  const thumb = await request(bookPath + '/thumbnail', member);
  assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
  assert.equal(Buffer.from(await thumb.arrayBuffer()).readUInt16BE(0), 0xffd8);
  await change(bookId, 'trash');
  assert.equal((await request(bookPath + '/thumbnail', member)).status, 404);
  assert.equal((await request(bookPath + '/chapters', member)).status, 404);
  assert.equal(
    (await call('read_file_text', { fileId: bookId })).isError,
    true,
  );
  await change(bookId, 'restore');
  const maxBytes = 30 * 1024 * 1024;
  const exact = await upload('boundary.txt', 'a'.repeat(maxBytes - 1) + 'Z');
  assert.equal(exact.status, 201);
  const boundary = await exact.json();
  const lastByte = await request('files/' + boundary.id + '/preview', member, {
    headers: { Range: 'bytes=-1' },
  });
  assert.equal(lastByte.status, 206);
  assert.equal(
    lastByte.headers.get('content-range'),
    `bytes ${maxBytes - 1}-${maxBytes - 1}/${maxBytes}`,
  );
  assert.equal(await lastByte.text(), 'Z');
  await grant('active', 'editor', false);
  assert.equal((await request(bookPath + '/chapters', member)).status, 403);
  assert.equal((await request(bookPath + '/thumbnail', member)).status, 403);
  assert.equal(await mcpStatus(headers), 403);
  assert.equal((await request(textUrl, member)).status, 403);
  assert.equal(
    (await request(preview, member, { headers: { Range: 'bytes=0-2' } }))
      .status,
    403,
  );
  assert.equal((await request(preview, '')).status, 401);
  assert.equal((await request(download, member)).status, 403);
  await grant('suspended', 'editor', true);
  assert.equal(await mcpStatus(headers), 403);
  await db.query(
    "UPDATE mcp_acs_tkn SET expry_dt=now()-interval '1 second' WHERE tkn_idntfr=$1",
    [issued.id],
  );
  assert.equal(await mcpStatus(headers), 401);
  assert.equal(
    (await request('mcp-tokens/' + issued.id, member, { method: 'DELETE' }))
      .status,
    204,
  );
  assert.equal(await mcpStatus(headers), 401);
  assert.equal((await request(download, member)).status, 403);
  assert.equal(
    (
      await request('logout', member, {
        method: 'POST',
        headers: { origin: 'https://other.example' },
      })
    ).status,
    403,
  );
  assert.equal((await post('logout', member, {})).status, 204);
  assert.equal((await request('me', member)).status, 401);
});

test('legacy M1 records and relationships survive physical renaming', async () => {
  const { readFile } = await import('node:fs/promises');
  assert.ok(process.env.DATABASE_URL);
  const schema = 'upgrade_' + randomUUID().replaceAll('-', '');
  const setup = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await setup.query('CREATE SCHEMA ' + schema);
  const db = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c search_path=' + schema,
  });
  try {
    await db.query(
      await readFile(
        new URL('../migrations/001-initial.sql', import.meta.url),
        'utf8',
      ),
    );
    const user = randomUUID(),
      file = randomUUID(),
      key = randomUUID();
    await db.query(
      "INSERT INTO accounts VALUES ($1,'https://user_acnt.google.com','subject','a@example.com','active','editor')",
      [user],
    );
    await db.query('INSERT INTO memberships VALUES ($1,1)', [user]);
    await db.query("INSERT INTO sessions VALUES ('digest',$1,now())", [user]);
    await db.query(
      "INSERT INTO entries SELECT $1,1,id,'legacy.txt',$2,$3 FROM entries WHERE parent_id IS NULL",
      [file, key, user],
    );
    await db.query(
      "INSERT INTO changes(actor,action,target) VALUES ($1,'file.upload',$2)",
      [user, file],
    );
    await migrate(db);
    await migrate(db);
    assert.deepEqual(
      (await db.query('SELECT artcl_idntfr,prcs_stts_cd FROM doc_artcl_txt'))
        .rows,
      [{ artcl_idntfr: file, prcs_stts_cd: 'processing' }],
    );
    const { rows } = await db.query(
      `SELECT a.user_eml_addr, e.s3_objt_key, h.chg_hstry_sn
      FROM user_acnt a JOIN doc_space_acs_authrt m USING(acnt_idntfr)
      JOIN lgn_ssn s USING(acnt_idntfr) JOIN doc_space sp USING(doc_space_idntfr)
      JOIN doc_artcl e ON e.doc_space_idntfr=sp.doc_space_idntfr AND e.creatr_acnt_idntfr=a.acnt_idntfr
      JOIN doc_artcl parent ON e.up_artcl_idntfr=parent.artcl_idntfr
      JOIN chg_hstry h ON h.trgt_idntfr=e.artcl_idntfr AND h.oprtr_acnt_idntfr=a.acnt_idntfr
      WHERE e.artcl_idntfr=$1 AND s.ssn_tkn_sha256='digest' AND a.oidc_issuer='https://accounts.google.com'`,
      [file],
    );
    assert.deepEqual(rows, [
      { user_eml_addr: 'a@example.com', s3_objt_key: key, chg_hstry_sn: '1' },
    ]);
  } finally {
    await db.end();
    await setup.query('DROP SCHEMA ' + schema + ' CASCADE');
    await setup.end();
  }
});
