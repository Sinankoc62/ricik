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


app.post('/api/auth/login', async (req, res) => {
  const { telefon, sifre } = req.body;

  console.log('LOGIN START', telefon);

  try {
    console.log('DB QUERY START');

    const u = await pool.query(
      'SELECT * FROM kullanicilar WHERE telefon = $1',
      [telefon]
    );

    console.log('DB QUERY OK');
    console.log('ROWS:', u.rows.length);

    if (u.rows.length === 0) {
      console.log('USER NOT FOUND');
      return res.status(404).json({
        message: 'Kullanıcı bulunamadı'
      });
    }

    const user = u.rows[0];

    console.log('USER FOUND');

    const gecen = await bcrypt.compare(
      sifre,
      user.sifre_hash
    );

    console.log('PASSWORD CHECK:', gecen);

    if (!gecen) {
      return res.status(400).json({
        message: 'Şifre hatalı'
      });
    }

    console.log('TOKEN GENERATING');

    const token = jwt.sign(
      { id: user.id, rol: user.rol },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log('LOGIN SUCCESS');

    res.json({
      token,
      user
    });

  } catch (e) {
    console.error('LOGIN ERROR:', e);
    res.status(500).json({
      error: e.message
    });
  }
});