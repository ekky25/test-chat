import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { 
  getUserByUsername, 
  getAllUsers, 
  createUser, 
  updateUserRole, 
  deleteUser 
} from './database.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY;
const ROOM_SHARED_SECRET = process.env.ROOM_SHARED_SECRET || 'super-e2ee-room-secret-key-2026';

app.set('trust proxy', true);

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true
}));
app.use(express.json());

const ipAttempts = new Map();
const sessionStore = new Map();

// Canlı socket takibi: socketId -> { username, role }
const activeSockets = new Map();

function checkIpLock(clientIp, res) {
  const now = Date.now();
  const record = ipAttempts.get(clientIp) || {
    failCount: 0,
    lockedUntil: 0,
    currentPenaltySec: 30
  };

  if (record.lockedUntil > now) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    res.status(429).json({
      success: false,
      isLocked: true,
      remainingSec,
      message: `Çok fazla hatalı deneme! ${remainingSec} saniye bekleyin.`
    });
    return null;
  }
  return record;
}

function registerFailure(clientIp, record, res, errorMsg) {
  const now = Date.now();
  record.failCount += 1;

  if (record.failCount >= 3) {
    record.lockedUntil = now + (record.currentPenaltySec * 1000);
    const penalty = record.currentPenaltySec;
    record.currentPenaltySec *= 2;
    ipAttempts.set(clientIp, record);

    return res.status(429).json({
      success: false,
      isLocked: true,
      remainingSec: penalty,
      message: `${errorMsg} Erişim ${penalty} saniye kilitlendi.`
    });
  }

  ipAttempts.set(clientIp, record);
  return res.status(401).json({
    success: false,
    message: `${errorMsg} (Kalan hak: ${3 - record.failCount})`
  });
}

// 1. Aşama: Turnstile Bot Doğrulama
app.post('/api/verify-captcha', async (req, res) => {
  const { token } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!token) return res.status(400).json({ success: false, message: 'Bot doğrulaması eksik.' });

  try {
    const verifyRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: TURNSTILE_SECRET_KEY,
        response: token
      })
    });

    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      return res.status(403).json({ success: false, message: 'Bot doğrulaması geçersiz.' });
    }

    const sessionToken = crypto.randomBytes(32).toString('hex');
    sessionStore.set(sessionToken, {
      ip: clientIp,
      step: 'USERNAME',
      expiresAt: Date.now() + 15 * 60 * 1000
    });

    return res.json({ success: true, sessionToken });
  } catch {
    return res.status(500).json({ success: false, message: 'Doğrulama servisine ulaşılamadı.' });
  }
});

// 2. Aşama: Kullanıcı Adı Kontrolü
app.post('/api/verify-username', (req, res) => {
  const { username, sessionToken } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const session = sessionStore.get(sessionToken);
  if (!session || session.expiresAt < Date.now() || session.ip !== clientIp) {
    return res.status(401).json({ success: false, needCaptcha: true, message: 'Oturum süresi doldu.' });
  }

  const record = checkIpLock(clientIp, res);
  if (!record) return;

  const user = getUserByUsername(username);
  if (!user) {
    return registerFailure(clientIp, record, res, 'Kullanıcı bulunamadı.');
  }

  session.step = 'PASSWORD';
  session.attemptingUser = username;
  return res.json({ success: true, nextStep: 'PASSWORD' });
});

// 3. Aşama: Şifre Kontrolü
app.post('/api/verify-password', (req, res) => {
  const { password, sessionToken } = req.body;
  const clientIp = req.ip || req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  const session = sessionStore.get(sessionToken);
  if (!session || session.expiresAt < Date.now() || session.ip !== clientIp || session.step !== 'PASSWORD') {
    return res.status(401).json({ success: false, needCaptcha: true, message: 'Geçersiz oturum.' });
  }

  const record = checkIpLock(clientIp, res);
  if (!record) return;

  const user = getUserByUsername(session.attemptingUser);
  if (!user || user.password !== password) {
    return registerFailure(clientIp, record, res, 'Hatalı şifre.');
  }

  ipAttempts.delete(clientIp);
  session.step = 'AUTHENTICATED';
  session.user = user.username;
  session.role = user.role;

  return res.json({
    success: true,
    username: session.user,
    role: session.role,
    roomKeySecret: ROOM_SHARED_SECRET
  });
});

// Admin Yetki Kontrol Ara Yazılımı (Middleware)
function requireAdmin(req, res, next) {
  const { sessionToken } = req.body;
  const session = sessionStore.get(sessionToken);

  if (!session || session.step !== 'AUTHENTICATED' || session.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Yetkisiz erişim. Admin yetkisi gerekli.' });
  }
  req.adminSession = session;
  next();
}

// ADMIN API: Tüm Kullanıcıları Getir
app.post('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const list = getAllUsers();
    return res.json({ success: true, users: list });
  } catch {
    return res.status(500).json({ success: false, message: 'Kullanıcılar alınamadı.' });
  }
});

// ADMIN API: Kullanıcı Ekle
app.post('/api/admin/create-user', requireAdmin, (req, res) => {
  const { newUsername, newPassword, newRole } = req.body;
  const cleanUser = (newUsername || '').trim();
  const cleanPass = (newPassword || '').trim();
  const validRoles = ['admin', 'member', 'read_only'];
  const targetRole = validRoles.includes(newRole) ? newRole : 'member';

  if (!cleanUser || !cleanPass) {
    return res.status(400).json({ success: false, message: 'Kullanıcı adı ve şifre zorunludur.' });
  }

  if (getUserByUsername(cleanUser)) {
    return res.status(400).json({ success: false, message: 'Bu kullanıcı zaten mevcut.' });
  }

  try {
    createUser(cleanUser, cleanPass, targetRole);
    return res.json({ success: true, message: `"${cleanUser}" kullanıcısı başarıyla eklendi.` });
  } catch {
    return res.status(500).json({ success: false, message: 'Veritabanı kayıt hatası.' });
  }
});

// ADMIN API: Rol Değiştir
app.post('/api/admin/update-role', requireAdmin, (req, res) => {
  const { targetUsername, newRole } = req.body;
  const validRoles = ['admin', 'member', 'read_only'];

  if (!validRoles.includes(newRole)) {
    return res.status(400).json({ success: false, message: 'Geçersiz rol.' });
  }

  if (targetUsername === req.adminSession.user) {
    return res.status(400).json({ success: false, message: 'Kendi rolünüzü değiştiremezsiniz.' });
  }

  try {
    updateUserRole(targetUsername, newRole);
    return res.json({ success: true, message: `"${targetUsername}" rolü [${newRole}] olarak güncellendi.` });
  } catch {
    return res.status(500).json({ success: false, message: 'Rol güncellenemedi.' });
  }
});

// ADMIN API: Kullanıcı Sil
app.post('/api/admin/delete-user', requireAdmin, (req, res) => {
  const { targetUsername } = req.body;

  if (targetUsername === req.adminSession.user) {
    return res.status(400).json({ success: false, message: 'Kendi hesabınızı silemezsiniz.' });
  }

  try {
    deleteUser(targetUsername);
    return res.json({ success: true, message: `"${targetUsername}" başarıyla silindi.` });
  } catch {
    return res.status(500).json({ success: false, message: 'Kullanıcı silinemedi.' });
  }
});

// Socket.io Gerçek Zamanlı Mesajlaşma & Aktif Kullanıcı Yayını
const io = new Server(server, {
  cors: { origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }
});

function broadcastOnlineUsers() {
  const onlineList = Array.from(activeSockets.values());
  io.emit('online_users_update', onlineList);
}

io.on('connection', (socket) => {
  socket.on('join_room', (data) => {
    socket.join(data.roomId || 'default_room');
    
    // Sokete kullanıcı bilgilerini kaydet
    activeSockets.set(socket.id, {
      username: data.username,
      role: data.role,
      socketId: socket.id
    });

    broadcastOnlineUsers();
  });

  socket.on('send_message', (data) => {
    const user = activeSockets.get(socket.id);
    if (user && user.role === 'read_only') {
      return socket.emit('error_message', 'Salt okunur iznine sahipsiniz, mesaj atamazsınız.');
    }

    const targetRoom = data.roomId || 'default_room';
    socket.to(targetRoom).emit('receive_message', {
      sender: data.sender,
      encrypted: data.encrypted,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('disconnect', () => {
    activeSockets.delete(socket.id);
    broadcastOnlineUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Sunucu http://localhost:${PORT} üzerinde çalışıyor`);
});