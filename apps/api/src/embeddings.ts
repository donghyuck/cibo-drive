import type pg from 'pg';
import { transaction } from './drive-db.js';

export function embeddingProvider(env: NodeJS.ProcessEnv) {
  const model = env.CIBO_EMBED_MODEL;
  if (!model) return;
  const endpoint = env.CIBO_EMBED_URL || 'https://api.openai.com/v1/embeddings';
  const key = env.CIBO_EMBED_API_KEY;
  if (new URL(endpoint).hostname === 'api.openai.com' && !key)
    throw new Error('CIBO_EMBED_API_KEY is required for OpenAI');
  const dimensions = Number(env.CIBO_EMBED_DIMENSIONS || 1536);
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 8192)
    throw new Error('Invalid CIBO_EMBED_DIMENSIONS');
  return {
    model: model + '@' + dimensions,
    async embed(input: string[]): Promise<number[][]> {
      const res = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
        headers: {
          'Content-Type': 'application/json',
          ...(key && { Authorization: 'Bearer ' + key }),
        },
        body: JSON.stringify({ input, model, encoding_format: 'float' }),
      });
      if (!res.ok) throw new Error('Embedding HTTP ' + res.status);
      const result = await res.json();
      if (
        result.model !== model ||
        !Array.isArray(result.data) ||
        result.data.length !== input.length
      )
        throw new Error('Unexpected embedding response');
      return result.data
        .sort((a: { index: number }, b: { index: number }) => a.index - b.index)
        .map((item: { index: number; embedding: number[] }, index: number) => {
          const v = item.embedding;
          if (
            item.index !== index ||
            !Array.isArray(v) ||
            v.length !== dimensions ||
            !v.every(
              (n) => typeof n === 'number' && Number.isFinite(Math.fround(n)),
            ) ||
            !v.some((n) => Math.fround(n) !== 0)
          )
            throw new Error('Invalid embedding vector');
          return v;
        });
    },
  };
}

type Provider = NonNullable<ReturnType<typeof embeddingProvider>>;

export async function indexNext(db: pg.Pool, provider: Provider) {
  return transaction(db, async (client) => {
    const {
      rows: [job],
    } = await client.query(
      `SELECT t.artcl_idntfr id,t.idx_mdl_nm model,jsonb_array_length(t.srch_sctn_list) total
       FROM doc_artcl_txt t JOIN doc_artcl a USING (artcl_idntfr)
       WHERE t.prcs_stts_cd='ready' AND t.srch_sctn_list IS NOT NULL AND a.del_grp_idntfr IS NULL
       AND (t.idx_stts_cd='pending' OR t.idx_mdl_nm IS DISTINCT FROM $1)
       ORDER BY t.artcl_idntfr LIMIT 1 FOR UPDATE OF t SKIP LOCKED`,
      [provider.model],
    );
    if (!job) return false;
    if (job.model !== provider.model)
      await client.query('DELETE FROM doc_sctn_idx WHERE artcl_idntfr=$1', [
        job.id,
      ]);
    const {
      rows: [progress],
    } = await client.query(
      'SELECT COALESCE(MAX(sctn_sn)+1,0) AS next FROM doc_sctn_idx WHERE artcl_idntfr=$1',
      [job.id],
    );
    const { rows } = await client.query(
      `SELECT i, srch_sctn_list->i->>'text' AS text FROM doc_artcl_txt,
       generate_series($2::int,least($2::int+7,$3::int-1)) i WHERE artcl_idntfr=$1 ORDER BY i`,
      [job.id, progress.next, job.total],
    );
    if (rows.length) {
      let vectors: number[][];
      try {
        vectors = await provider.embed(rows.map((r) => r.text));
      } catch (err) {
        // Provider error bodies may contain document content or credentials.
        const message =
          err instanceof Error && /^Embedding HTTP \d{3}$/.test(err.message)
            ? err.message
            : '임베딩 요청 또는 응답 검증 실패';
        await client.query(
          "UPDATE doc_artcl_txt SET idx_stts_cd='failed',idx_mdl_nm=$2,idx_fail_rsn=$3 WHERE artcl_idntfr=$1",
          [job.id, provider.model, message],
        );
        return true;
      }
      for (const [n, row] of rows.entries())
        await client.query(
          'INSERT INTO doc_sctn_idx VALUES ($1,$2,$3::real[])',
          [job.id, row.i, vectors[n]],
        );
    }
    await client.query(
      'UPDATE doc_artcl_txt SET idx_stts_cd=$2,idx_mdl_nm=$3,idx_fail_rsn=NULL WHERE artcl_idntfr=$1',
      [
        job.id,
        progress.next + rows.length === job.total ? 'ready' : 'pending',
        provider.model,
      ],
    );
    return true;
  });
}

export async function retryIndex(db: pg.Pool, id: string) {
  const result = await db.query(
    "UPDATE doc_artcl_txt SET idx_stts_cd='pending',idx_fail_rsn=NULL WHERE artcl_idntfr=$1 AND idx_stts_cd='failed'",
    [id],
  );
  return result.rowCount === 1;
}

export function startIndexing(db: pg.Pool, provider: Provider) {
  async function tick() {
    let more = false;
    try {
      more = await indexNext(db, provider);
    } catch {
      console.error('Embedding queue unavailable');
    }
    setTimeout(tick, more ? 0 : 3000).unref();
  }
  void tick();
}
