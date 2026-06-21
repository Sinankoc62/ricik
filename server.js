const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const JWT_SECRET = process.env.JWT_SECRET || 'ricik_gizli_anahtar';
const aktifKullanicilar = new Map();

// ==========================================
// MİDDLEWARE (GÜVENLİK DUVARLARI)
// ==========================================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: "Token bulunamadı." });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) { res.status(401).json({ message: "Yetkisiz erişim." }); }
};

const adminMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.rol !== 'admin') return res.status(403).json({ message: "Admin yetkisi gerekiyor." });
    req.user = decoded;
    next();
  } catch (e) { res.status(401).json({ message: "Yetkisiz erişim." }); }
};

// ==========================================
// FAZ 1: AUTH (GİRİŞ & KAYIT) API'LERİ
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  const { ad, soyad, baba_adi, anne_adi, dogum_tarihi, telefon, sifre } = req.body;
  try {
    const varMi = await pool.query('SELECT id FROM kullanicilar WHERE telefon = $1', [telefon]);
    if (varMi.rows.length > 0) return res.status(400).json({ message: "Bu numara zaten kayıtlı." });
    
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(sifre, salt);
    
    const yeni = await pool.query(
      `INSERT INTO kullanicilar (ad, soyad, baba_adi, anne_adi, dogum_tarihi, telefon, sifre_hash) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ad, soyad, baba_adi, anne_adi, dogum_tarihi, telefon, hash]
    );
    res.status(201).json({ message: "Başvuru alındı. Admin onayı bekleniyor.", id: yeni.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  const { telefon, sifre } = req.body;
  try {
    const u = await pool.query('SELECT * FROM kullanicilar WHERE telefon = $1', [telefon]);
    if (u.rows.length === 0) return res.status(404).json({ message: "Kullanıcı bulunamadı." });
    
    const user = u.rows[0];
    const gecen = await bcrypt.compare(sifre, user.sifre_hash);
    if (!gecen) return res.status(400).json({ message: "Hatalı şifre." });
    
    if (user.durum === 'onay_bekliyor') return res.status(403).json({ message: "Hesabınız henüz onaylanmadı." });
    if (user.durum === 'engellenen') return res.status(403).json({ message: "Hesabınız engellendi." });

    const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: user.id, ad: user.ad, soyad: user.soyad, rol: user.rol } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// FAZ 1: ADMİN PANELİ API'LERİ
// ==========================================
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const durum = req.query.durum || 'onay_bekliyor';
    const users = await pool.query('SELECT id, ad, soyad, anne_adi, baba_adi, telefon, dogum_tarihi FROM kullanicilar WHERE durum = $1', [durum]);
    res.json(users.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id/status', adminMiddleware, async (req, res) => {
  const { yeniDurum } = req.body;
  try {
    await pool.query('UPDATE kullanicilar SET durum = $1 WHERE id = $2', [yeniDurum, req.params.id]);
    res.json({ message: "Kullanıcı durumu güncellendi." });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// FAZ 2: HARİTA API'Sİ (ENGELLEME KORUMALI)
// ==========================================
app.get('/api/ricikliler-haritasi', authMiddleware, async (req, res) => {
  try {
    const myId = req.user.id;
    const harita = await pool.query(
      `SELECT id, ad, soyad, meslek, enlem, boylam FROM kullanicilar 
       WHERE durum = 'aktif' AND haritada_goster = true AND enlem IS NOT NULL 
       AND id NOT IN (
         SELECT engellenen_id FROM kullanici_engelleri WHERE engelleyen_id = $1
         UNION
         SELECT engelleyen_id FROM kullanici_engelleri WHERE engellenen_id = $1
       )`, [myId]
    );
    res.json(harita.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================================
// FAZ 2: ANLIK CHAT SOKET MOTORU (SOCKET.IO)
// ==========================================
io.on('connection', (socket) => {
  socket.on('register_user', (userId) => {
    aktifKullanicilar.set(userId, socket.id);
    socket.join(`user_${userId}`);
  });

  socket.on('send_message', async (data) => {
    const { gonderen_id, alici_id, mesaj_metni } = data;
    try {
      // Engelleme Kontrolü
      const engel = await pool.query(
        `SELECT id FROM kullanici_engelleri 
         WHERE (engelleyen_id = $1 AND engellenen_id = $2) 
         OR (engelleyen_id = $2 AND engellenen_id = $1)`, [gonderen_id, alici_id]
      );
      if (engel.rows.length > 0) return socket.emit('message_error', { error: "Engel nedeniyle mesaj iletilemedi." });

      await pool.query('INSERT INTO mesajlar (gonderen_id, alici_id, mesaj_metni) VALUES ($1, $2, $3)', [gonderen_id, alici_id, mesaj_metni]);
      io.to(`user_${alici_id}`).emit('receive_message', data);
      socket.emit('message_sent_success', data);
    } catch (e) { socket.emit('message_error', { error: "Sistem hatası." }); }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Riçik Sunucusu Port ${PORT} üzerinde hazır!`));