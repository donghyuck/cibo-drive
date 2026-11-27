import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import pg from 'pg';
import express from 'express';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { driveRouter } from './drive.js';
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
    region: 'us-east-1',
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
  app.use(
    '/api',
    driveRouter({
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
    }),
  );
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
  async function login(credential: string) {
    const res = await post('login', '', { credential });
    assert.equal(res.status, 204);
    return res.headers.get('set-cookie')!.split(';')[0];
  }
  const master = await login('master');
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
  const grant = async (status: string, role: string, access: boolean) =>
    assert.equal(
      (await post('admin/accounts/' + me.id, master, { status, role, access }))
        .status,
      204,
    );
  await grant('active', 'editor', true);
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
    (await upload('large.txt', 'x'.repeat(10 * 1024 * 1024 + 1))).status,
    413,
  );
  const data = '첫 문서\n';
  const saved = await upload('회의록.md', data);
  assert.equal(saved.status, 201);
  const { id } = await saved.json();
  assert.equal((await upload('회의록.md', '다른 내용')).status, 409);
  assert.deepEqual(
    (await (await request('folder?id=' + child, member)).json()).entries,
    [{ id, name: '회의록.md', folder: false }],
  );
  const key = (
    await db.query(
      'SELECT s3_objt_key AS object_key FROM doc_artcl WHERE artcl_idntfr=$1',
      [id],
    )
  ).rows[0].object_key;
  assert.equal(
    (await fetch(env.S3_ENDPOINT + '/' + env.S3_BUCKET + '/' + key)).status,
    403,
  );
  const download = 'files/' + id;
  assert.equal(await (await request(download, member)).text(), data);
  await grant('active', 'viewer', true);
  assert.equal((await post('folders', member, { name: '차단' })).status, 403);
  assert.equal((await upload('차단.txt', 'x')).status, 403);
  assert.equal(await (await request(download, member)).text(), data);
  await grant('active', 'editor', false);
  assert.equal((await request(download, member)).status, 403);
  await grant('suspended', 'editor', true);
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
      "INSERT INTO accounts VALUES ($1,'issuer','subject','a@example.com','active','editor')",
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
    const { rows } = await db.query(
      `SELECT a.user_eml_addr, e.s3_objt_key, h.chg_hstry_sn
      FROM user_acnt a JOIN doc_space_acs_authrt m USING(acnt_idntfr)
      JOIN lgn_ssn s USING(acnt_idntfr) JOIN doc_space sp USING(doc_space_idntfr)
      JOIN doc_artcl e ON e.doc_space_idntfr=sp.doc_space_idntfr AND e.creatr_acnt_idntfr=a.acnt_idntfr
      JOIN doc_artcl parent ON e.up_artcl_idntfr=parent.artcl_idntfr
      JOIN chg_hstry h ON h.trgt_idntfr=e.artcl_idntfr AND h.oprtr_acnt_idntfr=a.acnt_idntfr
      WHERE e.artcl_idntfr=$1 AND s.ssn_tkn_sha256='digest'`,
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
