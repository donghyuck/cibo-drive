import express, { type Request, type Response } from 'express';
import pg from 'pg';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { OAuth2Client } from 'google-auth-library';
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';

export interface Identity {
  subject: string;
  email: string;
}
export interface Settings {
  db: pg.Pool;
  s3: S3Client;
  bucket: string;
  origin: string;
  clientId: string;
  masterSubject: string;
  verify: (credential: string) => Promise<Identity>;
}
export function googleVerifier(clientId: string) {
  const google = new OAuth2Client();
  return async (credential: string): Promise<Identity> => {
    const ticket = await google.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    const claims = ticket.getPayload();
    if (!claims?.sub || !claims.email_verified || !claims.email)
      throw new Error('Invalid identity');
    return { subject: claims.sub, email: claims.email };
  };
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const cookieName = 'cibo_session';
function digest(req: Request) {
  const token =
    (req.headers.cookie ?? '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + '='))
      ?.slice(cookieName.length + 1) ?? '';
  return hash(token);
}
function hash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
function nameOf(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    /[\\/\x00-\x1f\x7f]/u.test(value) ||
    ['.', '..'].includes(value.trim())
  )
    throw new HttpError(400, '이름을 확인하세요.');
  return value.trim();
}
async function transaction<T>(
  db: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function driveRouter(settings: Settings) {
  const { db, origin, masterSubject, clientId, s3, bucket } = settings;
  const router = express.Router();
  const cookie = {
    httpOnly: true,
    secure: origin.startsWith('https:'),
    sameSite: 'strict' as const,
    path: '/api',
  };
  router.use((req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (req.method !== 'GET' && req.headers.origin !== origin)
      return res.sendStatus(403);
    next();
  });
  router.use(express.json({ limit: '16kb' }));
  router.get('/config', (_req, res) => res.json({ clientId }));
  router.post('/login', async (req, res) => {
    if (!clientId)
      throw new HttpError(503, 'Google 로그인 설정이 필요합니다.');
    if (typeof req.body?.credential !== 'string')
      throw new HttpError(400, '인증 정보가 필요합니다.');
    const identity = await settings.verify(req.body.credential).catch(() => {
      throw new HttpError(401, 'Google 인증에 실패했습니다.');
    });
    const master = Boolean(masterSubject) && identity.subject === masterSubject;
    const token = randomBytes(32).toString('hex');
    await transaction(db, async (client) => {
      const account = await client.query(
        `INSERT INTO user_acnt(oidc_issuer,oidc_subject,user_eml_addr,acnt_stts_cd,role_cd)
        VALUES ('https://accounts.google.com',$1,$2,$3,$4) ON CONFLICT(oidc_issuer,oidc_subject)
        DO UPDATE SET user_eml_addr=excluded.user_eml_addr,
          acnt_stts_cd=CASE WHEN $5 THEN 'active' ELSE user_acnt.acnt_stts_cd END,
          role_cd=CASE WHEN $5 THEN 'admin' ELSE user_acnt.role_cd END RETURNING acnt_idntfr AS id`,
        [
          identity.subject,
          identity.email,
          master ? 'active' : 'pending',
          master ? 'admin' : 'viewer',
          master,
        ],
      );
      await client.query(
        "INSERT INTO lgn_ssn VALUES ($1,$2,now()+interval '8 hours')",
        [hash(token), account.rows[0].id],
      );
    });
    res
      .cookie(cookieName, token, { ...cookie, maxAge: 8 * 3600_000 })
      .sendStatus(204);
  });
  router.post('/logout', async (req, res) => {
    await db.query('DELETE FROM lgn_ssn WHERE ssn_tkn_sha256=$1', [
      digest(req),
    ]);
    res.clearCookie(cookieName, cookie).sendStatus(204);
  });
  router.use(async (req, res, next) => {
    const { rows } = await db.query(
      `SELECT a.acnt_idntfr AS id,a.user_eml_addr AS email,a.acnt_stts_cd AS status,a.role_cd AS role,a.oidc_subject AS subject,m.doc_space_idntfr AS space_id FROM user_acnt a
      JOIN lgn_ssn s ON s.acnt_idntfr=a.acnt_idntfr LEFT JOIN doc_space_acs_authrt m ON m.acnt_idntfr=a.acnt_idntfr
      WHERE s.ssn_tkn_sha256=$1 AND s.expry_dt>now()`,
      [digest(req)],
    );
    if (!rows.length) throw new HttpError(401, '로그인이 필요합니다.');
    res.locals.user = rows[0];
    next();
  });
  router.get('/me', (_req, res) => res.json(res.locals.user));
  router.use('/admin', (req, res, next) => {
    const u = res.locals.user;
    if (u.role !== 'admin' || u.status !== 'active')
      throw new HttpError(403, '관리 권한이 필요합니다.');
    next();
  });
  router.get('/admin/accounts', async (_req, res) => {
    const { rows } = await db.query(
      'SELECT a.acnt_idntfr AS id,user_eml_addr AS email,acnt_stts_cd AS status,role_cd AS role,doc_space_idntfr AS space_id,oidc_subject=$1 AS master FROM user_acnt a LEFT JOIN doc_space_acs_authrt m ON m.acnt_idntfr=a.acnt_idntfr ORDER BY user_eml_addr',
      [masterSubject],
    );
    res.json(rows);
  });
  router.post('/admin/accounts/:id', async (req, res) => {
    const { status, role, access } = req.body ?? {};
    if (
      !['active', 'pending', 'suspended'].includes(status) ||
      !['admin', 'editor', 'viewer'].includes(role) ||
      typeof access !== 'boolean'
    )
      throw new HttpError(400, '계정 설정을 확인하세요.');
    await transaction(db, async (client) => {
      const account = await client.query(
        'SELECT oidc_subject AS subject FROM user_acnt WHERE acnt_idntfr=$1 FOR UPDATE',
        [req.params.id],
      );
      if (!account.rowCount)
        throw new HttpError(404, '계정을 찾을 수 없습니다.');
      if (
        account.rows[0].subject === masterSubject &&
        (status !== 'active' || role !== 'admin')
      )
        throw new HttpError(
          400,
          '마스터 관리자 계정은 활성 관리자여야 합니다.',
        );
      await client.query(
        'UPDATE user_acnt SET acnt_stts_cd=$1,role_cd=$2 WHERE acnt_idntfr=$3',
        [status, role, req.params.id],
      );
      if (access)
        await client.query(
          'INSERT INTO doc_space_acs_authrt VALUES ($1,1) ON CONFLICT DO NOTHING',
          [req.params.id],
        );
      else
        await client.query(
          'DELETE FROM doc_space_acs_authrt WHERE acnt_idntfr=$1',
          [req.params.id],
        );
      await client.query(
        "INSERT INTO chg_hstry(oprtr_acnt_idntfr,job_type_cd,trgt_idntfr) VALUES ($1,'account.update',$2)",
        [res.locals.user.id, req.params.id],
      );
    });
    res.sendStatus(204);
  });

  router.use((req, res, next) => {
    const u = res.locals.user;
    if (
      u.status !== 'active' ||
      !u.space_id ||
      (req.method !== 'GET' && u.role === 'viewer')
    )
      throw new HttpError(403, '문서 공간 권한이 필요합니다.');
    next();
  });
  async function folder(id: unknown, space: number) {
    const { rows } = await db.query(
      `SELECT artcl_idntfr AS id,artcl_nm AS name,up_artcl_idntfr AS parent_id FROM doc_artcl WHERE doc_space_idntfr=$1 AND s3_objt_key IS NULL
      AND (CASE WHEN $2::uuid IS NULL THEN up_artcl_idntfr IS NULL ELSE artcl_idntfr=$2 END)`,
      [space, id ?? null],
    );
    if (!rows.length) throw new HttpError(404, '폴더를 찾을 수 없습니다.');
    return rows[0];
  }
  router.get('/folder', async (req, res) => {
    const current = await folder(req.query.id, res.locals.user.space_id);
    const { rows } = await db.query(
      'SELECT artcl_idntfr AS id,artcl_nm AS name,s3_objt_key IS NULL AS folder FROM doc_artcl WHERE up_artcl_idntfr=$1 ORDER BY folder DESC,artcl_nm',
      [current.id],
    );
    res.json({ current, entries: rows });
  });
  async function insert(
    res: Response,
    parent: string,
    name: string,
    key: string | null,
  ) {
    return transaction(db, async (client) => {
      const u = res.locals.user;
      const { rows } = await client.query(
        'INSERT INTO doc_artcl(doc_space_idntfr,up_artcl_idntfr,artcl_nm,s3_objt_key,creatr_acnt_idntfr) VALUES ($1,$2,$3,$4,$5) RETURNING artcl_idntfr AS id',
        [u.space_id, parent, name, key, u.id],
      );
      await client.query(
        'INSERT INTO chg_hstry(oprtr_acnt_idntfr,job_type_cd,trgt_idntfr) VALUES ($1,$2,$3)',
        [u.id, key ? 'file.upload' : 'folder.create', rows[0].id],
      );
      return rows[0];
    });
  }
  router.post('/folders', async (req, res) => {
    const name = nameOf(req.body?.name);
    const parent = await folder(req.body?.parent, res.locals.user.space_id);
    res.status(201).json(await insert(res, parent.id, name, null));
  });
  router.post(
    '/files',
    express.raw({ type: 'application/octet-stream', limit: '10mb' }),
    async (req, res) => {
      const name = nameOf(req.query.name);
      if (
        !['.pdf', '.docx', '.txt', '.md'].includes(extname(name).toLowerCase())
      )
        throw new HttpError(400, '지원하지 않는 확장자입니다.');
      if (!Buffer.isBuffer(req.body))
        throw new HttpError(400, '원본 파일이 필요합니다.');
      const parent = await folder(req.query.parent, res.locals.user.space_id);
      const key = randomUUID();
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: req.body }),
      );
      try {
        res.status(201).json(await insert(res, parent.id, name, key));
      } catch (error) {
        // A lost COMMIT response may still represent a committed file.
        const referenced = await db.query(
          'SELECT 1 FROM doc_artcl WHERE s3_objt_key=$1',
          [key],
        );
        if (!referenced.rowCount)
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        throw error;
      }
    },
  );
  router.get('/files/:id', async (req, res) => {
    const { rows } = await db.query(
      'SELECT s3_objt_key AS object_key,artcl_nm AS name FROM doc_artcl WHERE artcl_idntfr=$1 AND doc_space_idntfr=$2 AND s3_objt_key IS NOT NULL',
      [req.params.id, res.locals.user.space_id],
    );
    if (!rows.length) throw new HttpError(404, '파일을 찾을 수 없습니다.');
    const object = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: rows[0].object_key }),
    );
    if (!object.Body) throw new HttpError(502, '원본을 읽을 수 없습니다.');
    res
      .attachment(rows[0].name)
      .type('application/octet-stream')
      .set('X-Content-Type-Options', 'nosniff');
    await pipeline(object.Body as Readable, res);
  });
  router.use(((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status =
      error instanceof HttpError
        ? error.status
        : error.code === '23505'
          ? 409
          : error.code === '22P02'
            ? 400
            : error.status === 413
              ? 413
              : error.status === 400
                ? 400
                : 500;
    res.status(status).json({
      error:
        error instanceof HttpError
          ? error.message
          : status === 409
            ? '같은 이름이 있습니다.'
            : status === 413
              ? '10 MiB 이하 파일을 선택하세요.'
              : '요청을 처리할 수 없습니다.',
    });
  }) satisfies express.ErrorRequestHandler);
  return router;
}
