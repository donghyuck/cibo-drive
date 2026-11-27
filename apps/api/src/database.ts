import { readFile } from 'node:fs/promises';
import pg from 'pg';

export async function migrate(db: pg.Pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(383201)');
    const catalog = await client.query(`
      SELECT relname FROM pg_class
      WHERE relnamespace = current_schema()::regnamespace
        AND relname IN ('accounts', 'user_acnt')
    `);
    const names = new Set(catalog.rows.map((row) => row.relname));
    if (names.has('accounts') && names.has('user_acnt'))
      throw new Error('Conflicting Cibo Drive schemas');
    if (!names.has('user_acnt')) {
      // Existing M1 databases already have the initial schema and seed data.
      const files = names.has('accounts')
        ? ['002-standard-names.sql']
        : ['001-initial.sql', '002-standard-names.sql'];
      for (const file of files) {
        const sql = await readFile(
          new URL('../migrations/' + file, import.meta.url),
          'utf8',
        );
        await client.query(sql);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
