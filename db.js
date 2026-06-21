const { Pool } = require('pg');

// Supabase bulut veritabanı için en kararlı havuz (Pool) yapılandırması
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    // SSL sertifika hatalarını ve doğrulamalarını tamamen es geçerek bağlantıyı zorla aktifleştirir
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 10000, // Sunucunun veritabanını arama süresini 10 saniyeye çıkarıyoruz
  idleTimeoutMillis: 30000,
  max: 10 // Maksimum eşzamanlı bağlantı sınırı
});

// Veritabanı bağlantı durumunu sunucu loglarında izlemek için test mekanizması
pool.connect((err, client, release) => {
  if (err) {
    console.error('⚠️ Supabase Veritabanı Bağlantı Hatası:', err.message);
  } else {
    console.log('✅ Supabase Veritabanına Başarıyla Kilitlendi!');
    release();
  }
});

module.exports = pool;