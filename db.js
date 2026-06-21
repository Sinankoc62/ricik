const { Pool } = require('pg');

const pool = new Pool({
  host: 'aws-1-ap-northeast-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.yzbpjoxipqrxmndtjxul',
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('DB ERROR:', err);
  } else {
    console.log('✅ PostgreSQL bağlantısı başarılı');
    release();
  }
});

module.exports = pool;