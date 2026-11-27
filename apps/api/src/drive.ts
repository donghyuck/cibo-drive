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
    if (!clientId || !masterSubject)
      throw new HttpError(503, 'Google 로그인 설정이 필요합니다.');
    if (typeof req.body?.credential !== 'string')
      throw new HttpError(400, '인증 정보가 필요합니다.');
    const identity = await settings.verify(req.body.credential).catch(() => {
      throw new HttpError(401, 'Google 인증에 실패했습니다.');
    });
    const master = identity.subject === masterSubject;
    const token = randomBytes(32).toString('hex');
    await transaction(db, async (client) => {
      const account = await client.query(
        `INSERT INTO accounts(issuer,subject,email,status,role)
        VALUES ('https://accounts.google.com',$1,$2,$3,$4) ON CONFLICT(issuer,subject)
        DO UPDATE SET email=excluded.email,
          status=CASE WHEN $5 THEN 'active' ELSE accounts.status END,
          role=CASE WHEN $5 THEN 'admin' ELSE accounts.role END RETURNING id`,
        [
          identity.subject,
          identity.email,
          master ? 'active' : 'pending',
          master ? 'admin' : 'viewer',
          master,
        ],
      );
      await client.query(
        "INSERT INTO sessions VALUES ($1,$2,now()+interval '8 hours')",
        [hash(token), account.rows[0].id],
      );
    });
    res
      .cookie(cookieName, token, { ...cookie, maxAge: 8 * 3600_000 })
      .sendStatus(204);
  });
  router.post('/logout', async (req, res) => {
    await db.query('DELETE FROM sessions WHERE digest=$1', [digest(req)]);
    res.clearCookie(cookieName, cookie).sendStatus(204);
  });
  router.use(async (req, res, next) => {
    const { rows } = await db.query(
      `SELECT a.id,a.email,a.status,a.role,a.subject,m.space_id FROM accounts a
      JOIN sessions s ON s.account_id=a.id LEFT JOIN memberships m ON m.account_id=a.id
      WHERE s.digest=$1 AND s.expires_at>now()`,
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
      'SELECT a.id,email,status,role,space_id,subject=$1 AS master FROM accounts a LEFT JOIN memberships m ON m.account_id=a.id ORDER BY email',
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
        'SELECT subject FROM accounts WHERE id=$1 FOR UPDATE',
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
      await client.query('UPDATE accounts SET status=$1,role=$2 WHERE id=$3', [
        status,
        role,
        req.params.id,
      ]);
      if (access)
        await client.query(
          'INSERT INTO memberships VALUES ($1,1) ON CONFLICT DO NOTHING',
          [req.params.id],
        );
      else
        await client.query('DELETE FROM memberships WHERE account_id=$1', [
          req.params.id,
        ]);
      await client.query(
        "INSERT INTO changes(actor,action,target) VALUES ($1,'account.update',$2)",
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
      `SELECT id,name,parent_id FROM entries WHERE space_id=$1 AND object_key IS NULL
      AND (CASE WHEN $2::uuid IS NULL THEN parent_id IS NULL ELSE id=$2 END)`,
      [space, id ?? null],
    );
    if (!rows.length) throw new HttpError(404, '폴더를 찾을 수 없습니다.');
    return rows[0];
  }
  router.get('/folder', async (req, res) => {
    const current = await folder(req.query.id, res.locals.user.space_id);
    const { rows } = await db.query(
      'SELECT id,name,object_key IS NULL AS folder FROM entries WHERE parent_id=$1 ORDER BY folder DESC,name',
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
        'INSERT INTO entries(space_id,parent_id,name,object_key,created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [u.space_id, parent, name, key, u.id],
      );
      await client.query(
        'INSERT INTO changes(actor,action,target) VALUES ($1,$2,$3)',
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
          'SELECT 1 FROM entries WHERE object_key=$1',
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
      'SELECT object_key,name FROM entries WHERE id=$1 AND space_id=$2 AND object_key IS NOT NULL',
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
    res
      .status(status)
      .json({
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
