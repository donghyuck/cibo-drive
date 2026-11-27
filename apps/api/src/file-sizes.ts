import { HeadObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import type pg from 'pg';

// Older uploads predate file_sz. Use metadata requests only, outside the list
// request, and leave unavailable sizes unknown for a later startup.
export async function fillMissingFileSizes(
  db: pg.Pool,
  s3: S3Client,
  bucket: string,
) {
  let cursor: string | null = null;
  for (;;) {
    const { rows }: pg.QueryResult<{ id: string; key: string }> =
      await db.query(
        `SELECT artcl_idntfr AS id,s3_objt_key AS key FROM doc_artcl
      WHERE s3_objt_key IS NOT NULL AND file_sz IS NULL AND ($1::uuid IS NULL OR artcl_idntfr>$1)
      ORDER BY artcl_idntfr LIMIT 50`,
        [cursor],
      );
    for (const row of rows) {
      cursor = row.id;
      try {
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: row.key }),
          { abortSignal: AbortSignal.timeout(10000) },
        );
        if (head.ContentLength !== undefined)
          await db.query(
            'UPDATE doc_artcl SET file_sz=$2 WHERE artcl_idntfr=$1 AND file_sz IS NULL',
            [row.id, head.ContentLength],
          );
      } catch {
        console.warn('Could not backfill file size:', row.id);
      }
    }
    if (rows.length < 50) return;
  }
}
