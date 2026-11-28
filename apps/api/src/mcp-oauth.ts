import express from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Settings } from './drive.js';
import { HttpError, transaction } from './drive-db.js';

const clientId = 'cibo-codex';
const scope = 'documents:read';
const secret = () => randomBytes(32).toString('base64url');
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const resourceUrl = (origin: string) => origin + '/api/mcp';
const resourceMetadata = (origin: string) =>
  origin + '/.well-known/oauth-protected-resource/api/mcp';

export function oauthChallenge(origin: string) {
  return `Bearer realm="cibo-drive", resource_metadata="${resourceMetadata(origin)}", scope="${scope}"`;
}

export function accessDigest(token: string, origin: string) {
  return sha256(
    token.startsWith('cibo_oauth_')
      ? resourceUrl(origin) + '\n' + token
      : token,
  );
}

export function oauthDiscovery(origin: string) {
  const router = express.Router();
  router.get(
    ['/oauth-protected-resource', '/oauth-protected-resource/api/mcp'],
    (_, res) =>
      res.json({
        resource: resourceUrl(origin),
        authorization_servers: [origin],
        scopes_supported: [scope],
        bearer_methods_supported: ['header'],
      }),
  );
  router.get('/oauth-authorization-server', (_, res) =>
    res.json({
      issuer: origin,
      authorization_endpoint: origin + '/api/oauth/authorize',
      token_endpoint: origin + '/api/oauth/token',
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [scope],
    }),
  );
  return router;
}

const authorizeRequest = z.object({
  client_id: z.literal(clientId),
  response_type: z.literal('code'),
  redirect_uri: z
    .string()
    .regex(
      /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/callback(?:\/[A-Za-z0-9_-]{12})?$/,
    )
    .refine((url) => {
      try {
        return Boolean(new URL(url).port) || url.includes(':80/');
      } catch {
        return false;
      }
    }),
  state: z.string().min(1).max(512),
  code_challenge: z.string().regex(/^[\w-]{43}$/),
  code_challenge_method: z.literal('S256'),
  resource: z.string().optional(),
  scope: z.literal(scope).optional(),
});

function authorization(input: unknown, origin: string) {
  const request = authorizeRequest.safeParse(input);
  if (
    !request.success ||
    (request.data.resource && request.data.resource !== resourceUrl(origin))
  )
    throw new HttpError(400, 'Codex의 OAuth 요청 주소와 설정을 확인하세요.');
  return request.data;
}

export function oauthProtocolRoutes({ db, origin }: Settings) {
  const router = express.Router();
  router.use((_, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    next();
  });
  router.get('/authorize', (req, res) => {
    const request = authorization(req.query, origin);
    const url = new URL('/', origin);
    url.hash = new URLSearchParams({ ...request, cibo_oauth: '1' }).toString();
    res.redirect(303, url.href);
  });
  router.post(
    '/token',
    express.urlencoded({ extended: false, limit: '8kb' }),
    async (req, res) => {
      const body = req.body ?? {};
      if (body.client_id !== clientId)
        return res.status(400).json({ error: 'invalid_client' });
      if (body.resource !== undefined && body.resource !== resourceUrl(origin))
        return res.status(400).json({ error: 'invalid_target' });
      if (body.scope !== undefined && body.scope !== scope)
        return res.status(400).json({ error: 'invalid_scope' });
      const refresh = body.grant_type === 'refresh_token';
      if (!refresh && body.grant_type !== 'authorization_code')
        return res.status(400).json({ error: 'unsupported_grant_type' });
      const proof = refresh ? body.refresh_token : body.code;
      if (typeof proof !== 'string' || !/^[\w-]{43}$/.test(proof))
        return res.status(400).json({ error: 'invalid_grant' });
      if (
        !refresh &&
        (typeof body.code_verifier !== 'string' ||
          !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier) ||
          typeof body.redirect_uri !== 'string')
      )
        return res.status(400).json({ error: 'invalid_grant' });
      const accessToken = 'cibo_oauth_' + secret(),
        refreshToken = secret();
      const condition = refresh
        ? 't.rfrsh_tkn_sha256=$1 AND t.rfrsh_expry_dt>now()'
        : 't.tkn_sha256=$1 AND t.expry_dt>now() AND t.pkce_challenge=$5 AND t.oauth_redirect_url=$6';
      const updated = await db.query(
        `UPDATE mcp_acs_tkn t SET tkn_sha256=$3, expry_dt=now()+interval '1 hour',
        rfrsh_tkn_sha256=$4, rfrsh_expry_dt=now()+interval '90 days',
        pkce_challenge=NULL, oauth_redirect_url=NULL
        WHERE ${condition} AND t.oauth_rsrc_url=$2
        AND EXISTS (SELECT 1 FROM user_acnt a JOIN doc_space_acs_authrt m USING(acnt_idntfr)
          WHERE a.acnt_idntfr=t.acnt_idntfr AND a.acnt_stts_cd='active' AND m.doc_space_idntfr=t.doc_space_idntfr)`,
        [
          sha256(proof),
          resourceUrl(origin),
          accessDigest(accessToken, origin),
          sha256(refreshToken),
          ...(refresh
            ? []
            : [
                createHash('sha256')
                  .update(body.code_verifier)
                  .digest('base64url'),
                body.redirect_uri,
              ]),
        ],
      );
      if (!updated.rowCount)
        return res.status(400).json({ error: 'invalid_grant' });
      return res.json({
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        scope,
      });
    },
  );
  return router;
}

export function oauthConsentRoutes({ db, origin }: Settings) {
  const router = express.Router();
  router.post('/approve', async (req, res) => {
    const request = authorization(req.body, origin);
    const user = res.locals.user;
    const redirect = new URL(request.redirect_uri);
    redirect.searchParams.set('state', request.state);
    if (req.body.approve === false) {
      redirect.searchParams.set('error', 'access_denied');
      return res.json({ redirect: redirect.href });
    }
    if (user.status !== 'active' || !user.space_id)
      throw new HttpError(403, '활성 계정과 문서 공간 접근권한이 필요합니다.');
    if (req.body.approve !== true)
      throw new HttpError(400, '읽기 권한 승인 여부를 확인하세요.');
    const code = secret();
    await transaction(db, async (client) => {
      await client.query(
        'SELECT acnt_idntfr FROM user_acnt WHERE acnt_idntfr=$1 FOR UPDATE',
        [user.id],
      );
      await client.query(
        'DELETE FROM mcp_acs_tkn WHERE acnt_idntfr=$1 AND coalesce(rfrsh_expry_dt,expry_dt)<=now()',
        [user.id],
      );
      const {
        rows: [result],
      } = await client.query(
        'SELECT count(*)::int AS total FROM mcp_acs_tkn WHERE acnt_idntfr=$1',
        [user.id],
      );
      if (result.total >= 10)
        throw new HttpError(409, '기존 연결을 해제한 뒤 다시 승인하세요.');
      await client.query(
        `INSERT INTO mcp_acs_tkn(acnt_idntfr,doc_space_idntfr,tkn_nm,tkn_sha256,expry_dt,oauth_rsrc_url,oauth_redirect_url,pkce_challenge)
         VALUES ($1,$2,'Codex · 브라우저 로그인',$3,now()+interval '3 minutes',$4,$5,$6)`,
        [
          user.id,
          user.space_id,
          sha256(code),
          resourceUrl(origin),
          request.redirect_uri,
          request.code_challenge,
        ],
      );
    });
    redirect.searchParams.set('code', code);
    return res.json({ redirect: redirect.href });
  });
  return router;
}
