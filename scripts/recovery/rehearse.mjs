// Restore only into containers created by this process. No source credentials required.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { command, digest, digestFile, metadata, pgEnv } from './state.mjs';
import { verifyApp } from './verify-app.mjs';

process.umask(0o077);
if (!process.argv[2]) throw new Error('Usage: rehearse.mjs BACKUP_DIRECTORY');
const dir = resolve(process.argv[2]),
  m = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
assert.equal(m.version, 1);
assert.deepEqual(await digestFile(join(dir, 'database.dump')), m.dump);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
for (const f of m.files) {
  assert.match(f.key, uuid);
  assert.deepEqual(await digestFile(join(dir, 'objects', f.key)), {
    size: f.size,
    sha256: f.sha256,
  });
}
const run = 'cibo-restore-' + randomUUID().slice(0, 12),
  bucket = 'cibo-restore',
  ids = [];
const pgPassword = randomBytes(32).toString('hex'),
  appPassword = randomBytes(32).toString('hex'),
  access = randomUUID(),
  secret = randomBytes(32).toString('hex');
let db, admin, s3;
async function launch(image, port, env, args = []) {
  const id = await command(
    'docker',
    [
      'run',
      '-d',
      '--network',
      run,
      '-p',
      '127.0.0.1::' + port,
      ...Object.keys(env).flatMap((k) => ['-e', k]),
      image,
      ...args,
    ],
    { ...process.env, ...env },
  );
  ids.push(id);
  const addr = await command('docker', ['port', id, port + '/tcp']);
  assert.match(addr, /^127\.0\.0\.1:\d+$/);
  return addr;
}
async function waitReady(check) {
  for (let n = 0; n < 45; n++) {
    try {
      return await check();
    } catch (e) {
      if (n === 44) throw e;
      await delay(1000);
    }
  }
}
await command('docker', ['network', 'create', run]);
try {
  const addr = await launch(
    'postgres:17-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73',
    5432,
    { POSTGRES_PASSWORD: pgPassword },
  );
  const endpoint =
    'http://' +
    (await launch(
      'chrislusf/seaweedfs@sha256:7ca46aeae2f223b37e5d91593c17ab37738eec6df6ab69b48a0487f7643342b9',
      8333,
      {
        AWS_ACCESS_KEY_ID: access,
        AWS_SECRET_ACCESS_KEY: secret,
        S3_BUCKET: bucket,
      },
      ['mini', '-dir=/data'],
    ));
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: access, secretAccessKey: secret },
  });
  admin = new pg.Pool({
    connectionString:
      'postgresql://postgres:' + pgPassword + '@' + addr + '/postgres',
  });
  await waitReady(() => admin.query('SELECT 1'));
  await waitReady(() => s3.send(new HeadBucketCommand({ Bucket: bucket })));
  await admin.query("CREATE ROLE cibo LOGIN PASSWORD '" + appPassword + "'");
  await admin.query('CREATE DATABASE cibo OWNER cibo');
  const url = 'postgresql://cibo:' + appPassword + '@' + addr + '/cibo';
  await command(
    'pg_restore',
    [
      '--dbname=cibo',
      '--single-transaction',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      join(dir, 'database.dump'),
    ],
    pgEnv(url),
  );
  db = new pg.Pool({ connectionString: url });
  const restored = await metadata(db);
  assert.deepEqual(restored, m.state);
  assert.equal(
    (
      await db.query(
        'SELECT (SELECT count(*) FROM lgn_ssn)+(SELECT count(*) FROM mcp_acs_tkn) n',
      )
    ).rows[0].n,
    '0',
  );
  for (const f of m.files) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: f.key,
        ContentLength: f.size,
        Body: createReadStream(join(dir, 'objects', f.key)),
      }),
    );
    const o = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: f.key }),
    );
    assert.deepEqual(await digest(o.Body), { size: f.size, sha256: f.sha256 });
  }
  const references = await db.query(
    'SELECT artcl_idntfr AS id,s3_objt_key AS key FROM doc_artcl WHERE s3_objt_key IS NOT NULL ORDER BY artcl_idntfr',
  );
  assert.deepEqual(
    references.rows,
    m.files.map(({ id, key }) => ({ id, key })),
  );
  const keys = [];
  let cursor;
  do {
    const list = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: cursor }),
    );
    keys.push(...(list.Contents ?? []).map((x) => x.Key));
    cursor = list.NextContinuationToken;
  } while (cursor);
  assert.deepEqual(keys.sort(), m.files.map((f) => f.key).sort());
  const checks = await verifyApp(db, s3, bucket, m);
  const report = {
    snapshot: m.at,
    verifiedAt: new Date().toISOString(),
    files: keys.length,
    bytes: m.files.reduce((n, f) => n + f.size, 0),
    tableCounts: Object.fromEntries(
      Object.entries(restored).map(([k, v]) => [k, v.count]),
    ),
    checks,
  };
  await writeFile(join(dir, 'verified.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  try {
    await db?.end();
    await admin?.end();
    s3?.destroy();
  } finally {
    for (const id of ids.reverse()) await command('docker', ['rm', '-fv', id]);
    await command('docker', ['network', 'rm', run]);
  }
}
