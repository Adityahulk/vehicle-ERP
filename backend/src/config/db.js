const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

const query = (text, params) => pool.query(text, params);

const getClient = () => pool.connect();

/**
 * Execute a query that automatically enforces company_id scoping.
 * Appends `AND company_id = $N` to the SQL and adds companyId to params.
 * Throws if companyId is falsy — never allow unscoped tenant queries.
 */
function queryWithCompany(text, params, companyId) {
  if (!companyId) {
    throw new Error('queryWithCompany: company_id is required');
  }
  const idx = (params?.length || 0) + 1;
  const scopedSql = `${text} AND company_id = $${idx}`;
  const scopedParams = [...(params || []), companyId];
  return pool.query(scopedSql, scopedParams);
}

module.exports = { pool, query, getClient, queryWithCompany };
