import pg from 'pg';

export async function migrate(db: pg.Pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(383201)');
    await client.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuer text NOT NULL, subject text NOT NULL,
        email text NOT NULL, status text NOT NULL CHECK (status IN ('pending','active','suspended')),
        role text NOT NULL CHECK (role IN ('admin','editor','viewer')), UNIQUE(issuer,subject)
      );
      CREATE TABLE IF NOT EXISTS spaces (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TABLE IF NOT EXISTS memberships (
        account_id uuid REFERENCES accounts PRIMARY KEY, space_id integer REFERENCES spaces NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        digest text PRIMARY KEY, account_id uuid REFERENCES accounts NOT NULL, expires_at timestamptz NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), space_id integer REFERENCES spaces NOT NULL,
        parent_id uuid REFERENCES entries, name text NOT NULL, object_key uuid UNIQUE,
        created_by uuid REFERENCES accounts, UNIQUE(parent_id,name)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS single_root ON entries(space_id) WHERE parent_id IS NULL;
      CREATE INDEX IF NOT EXISTS entries_parent ON entries(parent_id);
      CREATE TABLE IF NOT EXISTS changes (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor uuid REFERENCES accounts NOT NULL,
        action text NOT NULL, target uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
      );
      INSERT INTO spaces VALUES (1,'팀 문서 공간') ON CONFLICT DO NOTHING;
      INSERT INTO entries(space_id,name) VALUES(1,'팀 문서 공간') ON CONFLICT DO NOTHING;
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
