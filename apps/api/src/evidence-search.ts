import type pg from 'pg';
import type { EmbeddingProvider } from './embeddings.js';
import { tree } from './drive-reads.js';

export const tokenAccess = (
  parameter: '$1' | '$5',
) => `SELECT a.acnt_stts_cd AS status,t.doc_space_idntfr AS space,m.acnt_idntfr AS member
      FROM mcp_acs_tkn t JOIN user_acnt a USING(acnt_idntfr)
      LEFT JOIN doc_space_acs_authrt m ON m.acnt_idntfr=a.acnt_idntfr AND m.doc_space_idntfr=t.doc_space_idntfr
      WHERE t.tkn_sha256=${parameter} AND t.expry_dt>now()`;

const sessionAccess = `SELECT a.acnt_stts_cd AS status,m.doc_space_idntfr AS space,m.acnt_idntfr AS member
  FROM lgn_ssn s JOIN user_acnt a USING(acnt_idntfr)
  JOIN doc_space_acs_authrt m USING(acnt_idntfr)
  WHERE s.ssn_tkn_sha256=$5 AND s.expry_dt>now()`;

export type SourceRange = {
  unit: 'page' | 'chapter';
  start: number;
  end: number;
};

export function previewLink(
  origin: string,
  fileId: string,
  segment: number,
  offset = 0,
  length = 0,
) {
  const url = new URL('/', origin);
  url.search = new URLSearchParams({
    file: fileId,
    segment: String(segment),
    offset: String(offset),
    length: String(length),
  }).toString();
  return url.href;
}

export async function searchPassages(
  db: pg.Pool,
  embeddings: EmbeddingProvider,
  origin: string,
  space: number,
  credential: { kind: 'web' | 'mcp'; hash: string },
  question: string,
  limit: number,
  fileId?: string,
  range?: SourceRange,
) {
  const [vector] = await embeddings.embed([question]);
  // Recheck the token after remote inference, in the same snapshot as the passages.
  const access = credential.kind === 'mcp' ? tokenAccess('$5') : sessionAccess;
  const { rows } = await db.query(
    tree +
      `,
        permitted AS (${access}), ranked AS (
          SELECT f.artcl_idntfr, f.artcl_nm, f.path, i.sctn_sn, sim.score
          FROM tree f JOIN doc_artcl_txt t USING(artcl_idntfr)
          JOIN doc_sctn_idx i USING(artcl_idntfr)
          CROSS JOIN LATERAL (
            SELECT sum(x::float8*y) / nullif(sqrt(sum(x::float8*x)*sum(y::float8*y)),0) AS score
            FROM unnest(i.emb_vctr,$2::real[]) AS v(x,y)
          ) sim
          WHERE EXISTS (SELECT 1 FROM permitted WHERE status='active' AND member IS NOT NULL AND space=$1)
          AND t.idx_stts_cd='ready' AND t.prcs_stts_cd='ready' AND t.idx_mdl_nm=$3
          AND ($6::uuid IS NULL OR f.artcl_idntfr=$6)
          AND ($7::text IS NULL OR (t.srch_sctn_list->i.sctn_sn->>'unit'=$7
            AND (t.srch_sctn_list->i.sctn_sn->>'start')::int BETWEEN $8 AND $9))
          AND f.s3_objt_key IS NOT NULL AND cardinality(i.emb_vctr)=cardinality($2::real[]) AND sim.score IS NOT NULL
          ORDER BY sim.score DESC,f.artcl_idntfr,i.sctn_sn LIMIT $4
        )
        SELECT r.artcl_idntfr AS "fileId",r.artcl_nm AS name,r.path,r.score,t.srch_sctn_list->r.sctn_sn AS passage
        FROM ranked r JOIN doc_artcl_txt t USING(artcl_idntfr)
        ORDER BY r.score DESC,r.artcl_idntfr,r.sctn_sn`,
    [
      space,
      vector,
      embeddings.model,
      limit,
      credential.hash,
      fileId ?? null,
      range?.unit ?? null,
      range?.start ?? null,
      range?.end ?? null,
    ],
  );
  return {
    results: rows.map(({ passage, ...file }) => ({
      ...file,
      ...passage,
      previewUrl: previewLink(
        origin,
        file.fileId,
        passage.segment,
        passage.offset,
        Array.from(passage.text).length,
      ),
      downloadUrl: new URL('/api/files/' + file.fileId, origin).href,
    })),
  };
}
