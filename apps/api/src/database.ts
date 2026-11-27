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
    // The column and indexes are committed together. Avoid taking an
    // exclusive table lock on every subsequent application startup.
    const trashColumn = await client.query(
      "SELECT 1 FROM pg_attribute WHERE attrelid='doc_artcl'::regclass AND attname='del_grp_idntfr' AND NOT attisdropped",
    );
    if (!trashColumn.rowCount) {
      await client.query(
        await readFile(
          new URL('../migrations/003-trash.sql', import.meta.url),
          'utf8',
        ),
      );
    }
    if (
      !(
        await client.query(
          "SELECT to_regclass(current_schema() || '.doc_artcl_txt') AS table_name",
        )
      ).rows[0].table_name
    ) {
      await client.query(
        await readFile(
          new URL('../migrations/004-document-text.sql', import.meta.url),
          'utf8',
        ),
      );
    }
    if (
      !(
        await client.query(
          "SELECT to_regclass(current_schema() || '.mcp_acs_tkn') AS table_name",
        )
      ).rows[0].table_name
    ) {
      await client.query(
        await readFile(
          new URL('../migrations/005-mcp-token.sql', import.meta.url),
          'utf8',
        ),
      );
    }
    const details = await client.query(
      "SELECT 1 FROM pg_attribute WHERE attrelid='doc_artcl'::regclass AND attname='file_sz' AND NOT attisdropped",
    );
    if (!details.rowCount)
      await client.query(
        await readFile(
          new URL('../migrations/006-file-details.sql', import.meta.url),
          'utf8',
        ),
      );
    // Preserve account IDs, memberships and history from earlier M1 builds.
    await client.query(`UPDATE user_acnt SET oidc_issuer='https://accounts.google.com'
      WHERE oidc_issuer='https://user_acnt.google.com'`);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
