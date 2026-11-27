import express from 'express';
import type pg from 'pg';
import { extname } from 'node:path';
import { HttpError, lockSpace, nameOf, transaction } from './drive-db.js';

import { tree, searchFiles } from './drive-reads.js';
const fields =
  'artcl_idntfr AS id, artcl_nm AS name, s3_objt_key IS NULL AS folder';
function checkedName(input: unknown, existing: string, isFile: boolean) {
  const name = nameOf(input);
  if (isFile && extname(existing).toLowerCase() !== extname(name).toLowerCase())
    throw new HttpError(400, '파일 확장자는 유지하세요.');
  return name;
}

export function entryRoutes(db: pg.Pool) {
  const r = express.Router();
  r.get('/search', async (req, res) => {
    const q = req.query.q;
    if (typeof q !== 'string' || !q.trim() || q.length > 200)
      throw new HttpError(400, '검색어를 확인하세요.');
    const rows = await searchFiles(db, res.locals.user.space_id, q.trim());
    res.json(rows);
  });
  r.get('/destinations/:id', async (req, res) => {
    const { rows } = await db.query(
      tree +
        ` SELECT artcl_idntfr AS id,path FROM tree
      WHERE s3_objt_key IS NULL AND NOT ($2::uuid=ANY(ids)) ORDER BY path`,
      [res.locals.user.space_id, req.params.id],
    );
    res.json(rows);
  });
  r.get('/trash', async (_req, res) => {
    if (res.locals.user.role === 'viewer')
      throw new HttpError(403, '휴지통 관리 권한이 필요합니다.');
    const { rows } = await db.query(
      `SELECT ${fields}, del_dt AS trashed_at FROM doc_artcl
      WHERE doc_space_idntfr=$1 AND del_grp_idntfr=artcl_idntfr ORDER BY del_dt DESC,artcl_idntfr`,
      [res.locals.user.space_id],
    );
    res.json(rows);
  });
  r.post('/entries/:id/:action', async (req, res) => {
    const { id, action } = req.params;
    if (!['rename', 'move', 'trash', 'restore'].includes(action))
      throw new HttpError(404, '지원하지 않는 작업입니다.');
    const u = res.locals.user;
    await transaction(db, async (client) => {
      await lockSpace(client, u.space_id);
      const {
        rows: [item],
      } = await client.query(
        `SELECT artcl_nm AS name,up_artcl_idntfr AS parent,s3_objt_key IS NOT NULL AS file,
        del_grp_idntfr AS batch FROM doc_artcl WHERE artcl_idntfr=$1 AND doc_space_idntfr=$2`,
        [id, u.space_id],
      );
      if (
        !item ||
        (action === 'restore' ? item.batch !== id : item.batch !== null)
      )
        throw new HttpError(404, '항목을 찾을 수 없습니다.');
      if (!item.parent)
        throw new HttpError(400, '문서 공간의 루트는 변경할 수 없습니다.');
      if (action === 'rename') {
        const name = checkedName(req.body?.name, item.name, item.file);
        await client.query(
          'UPDATE doc_artcl SET artcl_nm=$2 WHERE artcl_idntfr=$1',
          [id, name],
        );
      } else if (action === 'move') {
        const parent = req.body?.parent;
        if (typeof parent !== 'string')
          throw new HttpError(400, '대상 폴더를 선택하세요.');
        const {
          rows: [dest],
        } = await client.query(
          tree +
            ' SELECT $3::uuid=ANY(ids) AS cycle FROM tree WHERE artcl_idntfr=$2 AND s3_objt_key IS NULL',
          [u.space_id, parent, id],
        );
        if (!dest) throw new HttpError(404, '대상 폴더를 찾을 수 없습니다.');
        if (dest.cycle)
          throw new HttpError(
            400,
            '자기 자신이나 하위 폴더로 이동할 수 없습니다.',
          );
        await client.query(
          'UPDATE doc_artcl SET up_artcl_idntfr=$2 WHERE artcl_idntfr=$1',
          [id, parent],
        );
      } else if (action === 'trash') {
        // Previously trashed children belong to a different restore operation.
        await client.query(
          `WITH RECURSIVE subtree(id) AS (
          SELECT $1::uuid UNION ALL SELECT a.artcl_idntfr FROM doc_artcl a JOIN subtree t ON a.up_artcl_idntfr=t.id
          WHERE a.del_grp_idntfr IS NULL AND a.doc_space_idntfr=$2)
          UPDATE doc_artcl SET del_grp_idntfr=$1,del_dt=now() WHERE artcl_idntfr IN (SELECT id FROM subtree)`,
          [id, u.space_id],
        );
      } else {
        const parent = await client.query(
          'SELECT 1 FROM doc_artcl WHERE artcl_idntfr=$1 AND del_grp_idntfr IS NULL',
          [item.parent],
        );
        if (!parent.rowCount)
          throw new HttpError(409, '상위 폴더를 먼저 복원하세요.');
        const name = checkedName(
          req.body?.name ?? item.name,
          item.name,
          item.file,
        );
        await client.query(
          `UPDATE doc_artcl SET artcl_nm=CASE WHEN artcl_idntfr=$1 THEN $2 ELSE artcl_nm END,
          del_grp_idntfr=NULL,del_dt=NULL WHERE del_grp_idntfr=$1 AND doc_space_idntfr=$3`,
          [id, name, u.space_id],
        );
      }
      await client.query(
        'INSERT INTO chg_hstry(oprtr_acnt_idntfr,job_type_cd,trgt_idntfr) VALUES ($1,$2,$3)',
        [u.id, 'entry.' + action, id],
      );
    });
    res.sendStatus(204);
  });
  return r;
}
