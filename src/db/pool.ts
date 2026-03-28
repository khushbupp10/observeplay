import { Pool, type PoolConfig } from 'pg';

function getPoolConfig(): PoolConfig {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      max: parseInt(process.env.PG_POOL_MAX ?? '20', 10),
      idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT ?? '30000', 10),
      connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT ?? '5000', 10),
    };
  }

  return {
    host: process.env.PG_HOST ?? 'localhost',
    port: parseInt(process.env.PG_PORT ?? '5432', 10),
    database: process.env.PG_DATABASE ?? 'accessible_gaming',
    user: process.env.PG_USER ?? 'postgres',
    password: process.env.PG_PASSWORD ?? '',
    max: parseInt(process.env.PG_POOL_MAX ?? '20', 10),
    idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT ?? '30000', 10),
    connectionTimeoutMillis: parseInt(process.env.PG_CONNECT_TIMEOUT ?? '5000', 10),
  };
}

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(getPoolConfig());
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export { Pool };
