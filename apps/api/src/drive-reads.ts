import type pg from 'pg';
import { HttpError } from './drive-db.js';
export const tree = `WITH RECURSIVE tree AS (
 SELECT a.*, ARRAY[a.artcl_nm] AS path, ARRAY[a.artcl_idntfr] AS ids FROM doc_artcl a
 WHERE a.doc_space_idntfr=$1 AND a.up_artcl_idntfr IS NULL AND a.del_grp_idntfr IS NULL
 UNION ALL
 SELECT a.*,t.path||a.artcl_nm,t.ids||a.artcl_idntfr FROM tree t
 JOIN doc_artcl a ON a.up_artcl_idntfr=t.artcl_idntfr WHERE a.doc_space_idntfr=$1 AND a.del_grp_idntfr IS NULL
)`;
const fields =
  'artcl_idntfr AS id, artcl_nm AS name, s3_objt_key IS NULL AS folder,file_sz::float8 AS size,reg_dt AS registered_at';

export async function folder(db: pg.Pool, id: unknown, space: number) {
  const { rows } = await db.query(
    `SELECT artcl_idntfr AS id,artcl_nm AS name,up_artcl_idntfr AS parent_id FROM doc_artcl WHERE doc_space_idntfr=$1 AND del_grp_idntfr IS NULL AND s3_objt_key IS NULL
      AND (CASE WHEN $2::uuid IS NULL THEN up_artcl_idntfr IS NULL ELSE artcl_idntfr=$2 END)`,
    [space, id ?? null],
  );
  if (!rows.length) throw new HttpError(404, '폴더를 찾을 수 없습니다.');
  return rows[0];
}

export async function listFolder(
  db: pg.Pool,
  space: number,
  id?: unknown,
  limit: number | null = null,
  offset = 0,
) {
  const current = await folder(db, id, space);
  const { rows: entries } = await db.query(
    `SELECT ${fields} FROM doc_artcl WHERE up_artcl_idntfr=$1 AND doc_space_idntfr=$2 AND del_grp_idntfr IS NULL ORDER BY folder DESC,artcl_nm,artcl_idntfr LIMIT $3 OFFSET $4`,
    [current.id, space, limit, offset],
  );
  return { current, entries };
}
export async function searchFiles(
  db: pg.Pool,
  space: number,
  q: string,
  limit: number | null = null,
  offset = 0,
  folderId?: string,
) {
  if (folderId) await folder(db, folderId, space);
  const { rows } = await db.query(
    tree +
      ` SELECT ${fields},path[1:cardinality(path)-1] AS location,
    (SELECT max(rcd_dt) FROM chg_hstry WHERE trgt_idntfr=artcl_idntfr) AS modified_at FROM tree
    WHERE s3_objt_key IS NOT NULL AND strpos(lower(artcl_nm),lower($2))>0 AND ($5::uuid IS NULL OR $5=ANY(ids))
    ORDER BY path, artcl_idntfr LIMIT $3 OFFSET $4`,
    [space, q, limit, offset, folderId ?? null],
  );
  return rows;
}
export async function readText(
  db: pg.Pool,
  space: number,
  id: string,
  offset: number,
  limit = 10,
) {
  const {
    rows: [row],
  } = await db.query(
    `SELECT a.artcl_nm AS name,t.prcs_stts_cd AS status,t.fail_rsn AS reason,
      jsonb_array_length(t.src_sctn_list) AS total,
      ARRAY(SELECT t.src_sctn_list->i FROM generate_series($3::int,least($3::int+$4::int-1,jsonb_array_length(t.src_sctn_list)-1)) i ORDER BY i) AS segments
      FROM doc_artcl a JOIN doc_artcl_txt t USING(artcl_idntfr) WHERE a.artcl_idntfr=$1
      AND a.doc_space_idntfr=$2 AND a.del_grp_idntfr IS NULL`,
    [id, space, offset, limit],
  );
  if (!row) throw new HttpError(404, '파일을 찾을 수 없습니다.');
  return {
    ...row,
    fileId: id,
    offset,
    nextOffset: offset + limit < row.total ? offset + limit : null,
  };
}
