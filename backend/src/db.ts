import pg from 'pg';

const { Pool, types } = pg;

// Preserve PostgreSQL DATE (OID 1082) as literal YYYY-MM-DD strings without timezone shift
types.setTypeParser(1082, (value: string) => value);

export const DEFAULT_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5433/dealership_db';

export function createPool(connectionString?: string): pg.Pool {
  return new Pool({
    connectionString:
      connectionString || process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  });
}

export const pool = createPool();
