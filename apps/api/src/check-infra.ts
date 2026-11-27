import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';

const { DATABASE_URL, S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;
if (!DATABASE_URL || !S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  throw new Error('Set DATABASE_URL, S3_ENDPOINT, S3_BUCKET and both S3 credentials first.');
}

const db = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
const s3 = new S3Client({
  endpoint: S3_ENDPOINT, forcePathStyle: true, region: process.env.S3_REGION ?? 'us-east-1', maxAttempts: 1,
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});
try {
  await db.query('SELECT 1');
  console.log('PostgreSQL OK');
  await s3.send(new HeadBucketCommand({ Bucket: S3_BUCKET }), { abortSignal: AbortSignal.timeout(5000) });
  console.log('Object storage bucket OK');
} finally { await db.end(); s3.destroy(); }
