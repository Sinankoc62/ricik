process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('PG Pool Error:', err);
});

(async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');

    console.log('✅ PostgreSQL bağlantısı başarılı');
    console.log(result.rows[0]);

    client.release();
  } catch (err) {
    console.error('❌ PostgreSQL bağlantı hatası:', err);
  }
})();

module.exports = pool;