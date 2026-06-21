const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('./db');

const app = express();

// ==========================================
// CORS GÜVENLİK DUVARI GÜNCELLEMESİ (KESİN ÇÖZÜM)
// ==========================================
app.use(cors({
  origin: '*', // Tüm dış kaynaklardan (Vercel vb.) gelen isteklere izin verir
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true
}));

app.use(express.json());

// Tarayıcıların ön isteklerini (Preflight/OPTIONS) doğrudan onaylamak için
app.options('*', cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const JWT_SECRET = process.env.JWT_SECRET || 'ricik_gizli_anahtar';
const aktifKullanicilar = new Map();

// Canlılık Kontrolü (Sağlık Testi)
app.get('/', (req, res) => {
  res.json({ status: "OK", message: "Riçik Backend Motoru Aktif!" });
});

// ==========================================
// MIDDLEWARE (YETKİ KONTROLLERİ)
// ==========================================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: "Token bulunamadı. Lütfen giriş yapın." });
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) { res.status(401).json({ message: "Yetkisiz erişim veya geçersiz token." }); }
};

const adminMiddleware = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ message: "Token eksik." });
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.rol !== 'admin') return res.status(403).json({ message: "Bu işlem için admin yetkisi gerekiyor." });
    req.user = decoded;
    next();
  } catch (e) { res.status(401).json({ message: "Yetkisiz erişim." }); }
};

// ==========================================
// API ROTASI: GİRİŞ (LOGIN)
// ==========================================
app.post('/api/auth/login', async (req, res) => {
  const { telefon, sifre } = req.body;
  console.log(`Giriş denemesi yapılıyor: ${telefon}`); // Sunucu loglarında izlemek için

  try {
    const u = await pool.query('SELECT * FROM kullanicilar WHERE telefon = $1', [telefon]);
    if (u.rows.length === 0) {
      return res.status(404).json({ message: "Kullanıcı bulunamadı. Bilgilerinizi kontrol edin." });
    }
    
    const user = u.rows[0];
    const gecen = await bcrypt.compare(sifre, user.sifre_hash);
    if (!gecen) {
      return res.status(400).json({ message: "Girdiğiniz şifre hatalı." });
    }
    
    if (user.durum === 'onay_bekliyor') {
      return res.status(403).json({ message: "Hesabınız henüz dernek yöneticisi tarafından onaylanmamış." });
    }
    if (user.durum === 'engellenen') {
      return res.status(403).json({ message: "Hesabınız askıya alınmıştır." });
    }

    const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: '30d' });
    
    return res.json({ 
      token, 
      user: { id: user.id, ad: user.ad, soyad: user.soyad, rol: user.rol } 
    });
  } catch (e) { 
    console.error("Giriş API hatası:", e.message);
    return res.status(500).json({ message: "Veritabanı bağlantı hatası oluştu.", error: e.message }); 
  }
});

// ==========================================
// API ROTASI: KAYIT (REGISTER)
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  const { ad, soyad, baba_adi, anne_adi, dogum_tarihi, telefon, sifre } = req.body;
  try {
    const varMi = await pool.query('SELECT id FROM kullanicilar WHERE telefon = $1', [telefon]);
    if (varMi.rows.length > 0) return res.status(400).json({ message: "Bu telefon numarasıyla zaten bir başvuru var." });
    
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(sifre, salt);
    
    const yeni = await pool.query(
      `INSERT INTO kullanicilar (ad, soyad, baba_adi, anne_adi, dogum_tarihi, telefon, sifre_hash) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ad, soyad, baba_adi, anne_adi, dogum_tarihi, telefon, hash]
    );
    res.status(201).json({ message: "Başvurunuz alındı. Yönetim onayından sonra giriş yapabilirsiniz.", id: yeni.rows[0].id });
  } catch (e) { res.status(500).json({ message: "Kayıt sırasında hata oluştu.", error: e.message }); }
});

// ==========================================
// API ROTASI: ADMİN PANELİ (BAŞVURU LİSTESİ)
// ==========================================
app.get('/api/admin/users', adminMiddleware, async (req, res) => {
  try {
    const durum = req.query.durum || 'onay_bekliyor';
    const users = await pool.query('SELECT id, ad, soyad, anne_adi, baba_adi, telefon, dogum_tarihi FROM kullanicilar WHERE durum = $1', [durum]);
    res.json(users.rows);
  } catch (e) { res.status(500).json({ message: "Veri çekme hatası.", error: e.message }); }
});

app.put('/api/admin/users/:id/status', adminMiddleware, async (req, res) => {
  const { yeniDurum } = req.body;
  try {
    await pool.query('UPDATE kullanicilar SET durum = $1 WHERE id = $2', [yeniDurum, req.params.id]);
    res.json({ message: "Kullanıcı durumu başarıyla güncellendi." });
  } catch (e) { res.status(500).json({ message: "Güncelleme hatası.", error: e.message }); }
 });

// ==========================================
// SOKET MOTORU (ANLIK SOHBET)
// ==========================================
io.on('connection', (socket) => {
  socket.on('register_user', (userId) => {
    aktifKullanicilar.set(userId, socket.id);
    socket.join(`user_${userId}`);
  });

  socket.on('send_message', async (data) => {
    const { gonderen_id, alici_id, mesaj_metni } = data;
    try {
      const engel = await pool.query(
        `SELECT id FROM kullanici_engelleri 
         WHERE (engelleyen_id = $1 AND engellenen_id = $2) 
         OR (engelleyen_id = $2 AND engellenen_id = $1)`, [gonderen_id, alici_id]
      );
      if (engel.rows.length > 0) return socket.emit('message_error', { error: "Mesaj iletilemedi." });

      await pool.query('INSERT INTO mesajlar (gonderen_id, alici_id, mesaj_metni) VALUES ($1, $2, $3)', [gonderen_id, alici_id, mesaj_metni]);
      io.to(`user_${alici_id}`).emit('receive_message', data);
      socket.emit('message_sent_success', data);
    } catch (e) { socket.emit('message_error', { error: "İletim hatası." }); }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Riçik Sunucusu Port ${PORT} üzerinde hazır!`));