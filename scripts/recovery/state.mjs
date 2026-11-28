import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

export async function digest(stream) {
  const hash = createHash('sha256');
  let size = 0;
  for await (const bytes of stream) {
    hash.update(bytes);
    size += bytes.length;
  }
  return { size, sha256: hash.digest('hex') };
}
export const digestFile = (path) => digest(createReadStream(path));
export async function command(program, args, env = process.env) {
  const child = spawn(program, args, {
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const chunks = [];
  child.stdout.on('data', (b) => chunks.push(b));
  const [code] = await once(child, 'close');
  if (code !== 0) throw new Error(program + ' failed (' + code + ')');
  return Buffer.concat(chunks).toString().trim();
}
export function pgEnv(connectionString) {
  const u = new URL(connectionString);
  // libpq receives credentials in the child environment, never in argv.
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PGHOST: u.hostname,
    PGPORT: u.port || '5432',
    PGDATABASE: decodeURIComponent(u.pathname.slice(1)),
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGSSLMODE: u.searchParams.get('sslmode') || 'prefer',
    ...(u.searchParams.get('sslrootcert')
      ? { PGSSLROOTCERT: u.searchParams.get('sslrootcert') }
      : {}),
  };
}
export const tables = {
  user_acnt: 'acnt_idntfr',
  doc_space: 'doc_space_idntfr',
  doc_space_acs_authrt: 'acnt_idntfr',
  doc_artcl: 'artcl_idntfr',
  doc_artcl_txt: 'artcl_idntfr',
  chg_hstry: 'chg_hstry_sn',
};
// Hash canonical per-row digests in primary-key order. Payloads, including
// extracted text and thumbnail bytes, stay in PostgreSQL during comparison.
export async function metadata(db) {
  await db.query("SET TIME ZONE 'UTC'");
  const result = {};
  for (const [name, pk] of Object.entries(tables)) {
    const {
      rows: [row],
    } = await db.query(`SELECT count(*)::int AS count,
      encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY ${pk}),''),'UTF8')),'hex') AS sha256 FROM public.${name} t`);
    result[name] = row;
  }
  return result;
}
