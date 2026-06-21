const { Pool } = require('pg');

// Render'a yüklediğimiz DATABASE_URL çevre değişkenini kullanıyoruz
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false // Canlı veritabanı güvenliği (SSL) için zorunlu
  }
});

module.exports = pool;