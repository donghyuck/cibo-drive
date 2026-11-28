import { mkdir, writeFile, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { command, digestFile, metadata, pgEnv, tables } from './state.mjs';

process.umask(0o077);
if (!process.argv[2])
  throw new Error('Usage: backup.mjs NEW_PRIVATE_DIRECTORY');
const dir = resolve(process.argv[2]);
await mkdir(dir, { mode: 0o700 });
await mkdir(join(dir, 'objects'));
const e = process.env;
const db = new pg.Client({ connectionString: e.DATABASE_URL });
const s3 = new S3Client({
  endpoint: e.S3_ENDPOINT,
  region: e.S3_REGION || 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: e.S3_ACCESS_KEY_ID,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY,
  },
});
await db.connect();
try {
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {
    rows: [point],
  } = await db.query(
    'SELECT pg_export_snapshot() snapshot,transaction_timestamp() AS at,current_database() AS database',
  );
  const names = (
    await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  ).rows.map((r) => r.tablename);
  if (
    names.sort().join() !==
    [...Object.keys(tables), 'lgn_ssn', 'mcp_acs_tkn'].sort().join()
  )
    throw new Error('Review public table coverage before backup');
  const state = await metadata(db);
  const { rows: files } = await db.query(
    'SELECT artcl_idntfr AS id,s3_objt_key AS key,file_sz::float8 AS size FROM public.doc_artcl WHERE s3_objt_key IS NOT NULL ORDER BY artcl_idntfr',
  );
  await command(
    'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--schema=public',
      '--exclude-table-data=public.lgn_ssn',
      '--exclude-table-data=public.mcp_acs_tkn',
      '--snapshot=' + point.snapshot,
      '--file',
      join(dir, 'database.dump'),
    ],
    pgEnv(e.DATABASE_URL),
  );
  await db.query('COMMIT');
  // Object keys are random, immutable and not deleted by normal trash/move.
  for (const f of files) {
    const path = join(dir, 'objects', f.key);
    const object = await s3.send(
      new GetObjectCommand({ Bucket: e.S3_BUCKET, Key: f.key }),
    );
    const received = createHash('sha256');
    await pipeline(
      object.Body,
      new Transform({
        transform(chunk, encoding, done) {
          received.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    );
    const actual = await digestFile(path);
    if (
      received.digest('hex') !== actual.sha256 ||
      (f.size !== null && f.size !== actual.size) ||
      actual.size !== object.ContentLength
    )
      throw new Error('Object integrity mismatch: ' + f.id);
    Object.assign(f, actual);
  }
  const manifest = {
    version: 1,
    at: point.at,
    database: point.database,
    state,
    files,
    dump: await digestFile(join(dir, 'database.dump')),
  };
  await writeFile(join(dir, 'manifest.tmp'), JSON.stringify(manifest, null, 2));
  await rename(join(dir, 'manifest.tmp'), join(dir, 'manifest.json'));
  console.log(
    JSON.stringify({
      backup: dir,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.size, 0),
      at: point.at,
    }),
  );
} finally {
  await db.end();
  s3.destroy();
}
