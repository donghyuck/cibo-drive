import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type pg from 'pg';
import { transaction } from './drive-db.js';

import { rebuildPassages, splitPassages, type Segment } from './passages.js';

type Result =
  | { status: 'ready' | 'empty'; segments: Segment[] }
  | { status: 'failed'; reason: string };
const parser = fileURLToPath(
  new URL('../extraction/extract.py', import.meta.url),
);
const python =
  process.env.CIBO_EXTRACT_PYTHON ||
  fileURLToPath(new URL('../extraction/.venv/bin/python', import.meta.url));

async function parse<T>(
  stream: Readable,
  extension: string,
  ...options: string[]
): Promise<T> {
  const child = spawn(python, ['-I', parser, extension, ...options], {
    stdio: ['pipe', 'pipe', 'ignore'],
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  try {
    const exit = new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(new Error('Parser stopped')),
      );
    });
    const output = async () => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of child.stdout) {
        bytes += chunk.length;
        if (bytes > 16 * 1024 * 1024) throw new Error('Output too large');
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
    };
    const [result] = await Promise.all([
      output(),
      pipeline(stream, child.stdin),
      exit,
    ]);
    return result;
  } finally {
    clearTimeout(timer);
    stream.destroy();
    child.kill();
  }
}

// Keep the job lock until its result commits. Process loss releases the lock,
// leaving a pending row for the next worker. No lock is held on the original.
export async function extractNext(
  db: pg.Pool,
  read: (key: string) => Promise<Readable>,
) {
  return transaction(db, async (client) => {
    const {
      rows: [job],
    } =
      await client.query(`SELECT t.artcl_idntfr AS id,a.artcl_nm AS name,a.s3_objt_key AS key
      FROM doc_artcl_txt t JOIN doc_artcl a USING(artcl_idntfr)
      WHERE t.prcs_stts_cd='processing' AND a.del_grp_idntfr IS NULL
      ORDER BY t.artcl_idntfr LIMIT 1 FOR UPDATE OF t SKIP LOCKED`);
    if (!job) return false;
    let result: Result;
    try {
      result = await parse<Result>(
        await read(job.key),
        extname(job.name).toLowerCase(),
      );
    } catch {
      result = {
        status: 'failed',
        reason: '저장소 연결 또는 추출기 실행에 실패했습니다. 다시 시도하세요.',
      };
    }
    await client.query(
      `UPDATE doc_artcl_txt SET prcs_stts_cd=$2,src_sctn_list=$3::jsonb,fail_rsn=$4,srch_sctn_list=$5::jsonb,thmb_prcs_yn=false WHERE artcl_idntfr=$1`,
      [
        job.id,
        result.status,
        JSON.stringify(result.status === 'failed' ? [] : result.segments),
        result.status === 'failed' ? result.reason : null,
        JSON.stringify(
          result.status === 'ready' ? splitPassages(result.segments) : [],
        ),
      ],
    );
    return true;
  });
}
export async function thumbnailNext(
  db: pg.Pool,
  read: (key: string) => Promise<Readable>,
) {
  return transaction(db, async (client) => {
    const {
      rows: [job],
    } =
      await client.query(`SELECT t.artcl_idntfr AS id,a.artcl_nm AS name,a.s3_objt_key AS key,
      left(t.src_sctn_list->0->>'text',180) AS excerpt FROM doc_artcl_txt t JOIN doc_artcl a USING(artcl_idntfr)
      WHERE NOT t.thmb_prcs_yn AND t.prcs_stts_cd<>'processing' AND a.del_grp_idntfr IS NULL
      ORDER BY t.artcl_idntfr LIMIT 1 FOR UPDATE OF t SKIP LOCKED`);
    if (!job) return false;
    let image: Buffer | null = null;
    const ext = extname(job.name).toLowerCase();
    if (['.pdf', '.epub', '.docx'].includes(ext)) {
      try {
        const result = await parse<{ image?: string }>(
          await read(job.key),
          ext,
          '--thumbnail',
        );
        if (result.image) image = Buffer.from(result.image, 'base64');
      } catch {
        /* A cover is optional; keep the text excerpt and original. */
      }
    }
    await client.query(
      'UPDATE doc_artcl_txt SET thmb_prcs_yn=true,thmb_img=$2,thmb_cn=$3 WHERE artcl_idntfr=$1',
      [job.id, image, job.excerpt],
    );
    return true;
  });
}
export function startExtraction(
  db: pg.Pool,
  read: (key: string) => Promise<Readable>,
) {
  async function tick() {
    let more = false;
    try {
      more = await extractNext(db, read);
      if (await rebuildPassages(db)) more = true;
      if (await thumbnailNext(db, read)) more = true;
    } catch {
      console.error('Document extraction queue unavailable');
    }
    setTimeout(tick, more ? 0 : 3000).unref();
  }
  void tick();
}
