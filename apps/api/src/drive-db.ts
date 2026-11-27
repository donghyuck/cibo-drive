import type pg from 'pg';
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export function nameOf(value: unknown) {
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
export async function transaction<T>(
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

export async function lockSpace(client: pg.PoolClient, space: number) {
  await client.query(
    'SELECT doc_space_idntfr FROM doc_space WHERE doc_space_idntfr=$1 FOR UPDATE',
    [space],
  );
}
