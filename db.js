const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // Sertifika zincirindeki self-signed (kendinden imzalı) kısıtlamasını tamamen kaldırır
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 10
});

pool.connect((err, client, release) => {
  if (err) {
    console.error('⚠️ Supabase Veritabanı Bağlantı Hatası:', err.message);
  } else {
    console.log('✅ Supabase Veritabanına Başarıyla Kilitlendi!');
    release();
  }
});

module.exports = pool;