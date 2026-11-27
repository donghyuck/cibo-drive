import pg from 'pg';
import { startExtraction } from './document-text.js';
import type { Readable } from 'node:stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { migrate } from './database.js';
import { driveRouter, googleVerifier } from './drive.js';
import { createApp } from './app.js';

const enableLocalMcp = process.env.CIBO_ENABLE_LOCAL_MCP === 'true';
const port = Number(process.env.CIBO_API_PORT ?? 4000);

if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Invalid CIBO_API_PORT');
if (enableLocalMcp && process.env.NODE_ENV === 'production')
  throw new Error('MCP preview is local development only');

const app = createApp({ enableLocalMcp });
if (process.env.DATABASE_URL) {
  const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(db);
  const env = process.env;
  if (
    !env.S3_ENDPOINT ||
    !env.S3_BUCKET ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY
  )
    throw new Error('Configure S3 storage in .env');
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  startExtraction(db, async (key) => {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    if (!response.Body) throw new Error('Missing original');
    return response.Body as Readable;
  });
  app.use(
    '/api',
    driveRouter({
      db,
      s3,
      bucket: env.S3_BUCKET,
      origin: env.CIBO_WEB_ORIGIN ?? 'http://127.0.0.1:3000',
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      masterSubject: env.CIBO_MASTER_GOOGLE_SUB ?? '',
      verify: googleVerifier(env.GOOGLE_CLIENT_ID ?? ''),
    }),
  );
} else {
  app.use('/api', (_req, res) =>
    res.status(503).json({ error: '데이터베이스 설정이 필요합니다.' }),
  );
}
const host = enableLocalMcp
  ? '127.0.0.1'
  : (process.env.CIBO_API_HOST ?? '127.0.0.1');
app.listen(port, host, () => {
  console.log(`Cibo API: http://${host}:${port}/healthz`);
  if (enableLocalMcp)
    console.log(`MCP preview (no file access): http://127.0.0.1:${port}/mcp`);
});
