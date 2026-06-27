'use strict';
/**
 * sign_call — Production Server
 * Express + Socket.io + MongoDB Atlas
 */

require('dotenv').config();

const express      = require('express');
const http         = require('http');
const { Server }   = require('socket.io');
const mongoose     = require('mongoose');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cors         = require('cors');
const path         = require('path');
const rateLimit    = require('express-rate-limit');
const helmet       = require('helmet');

const app    = express();
const server = http.createServer(app);

// ─────────────────────────────────────────────────────────────
//  MIDDLEWARE  (order matters!)
// ─────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', methods: ['GET','POST','PATCH','DELETE','OPTIONS'] }));
app.use(express.json({ limit: '10kb' }));

// Log every incoming request (helps debug)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─────────────────────────────────────────────────────────────
//  MONGODB CONNECTION
// ─────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('FATAL: MONGODB_URI not set in .env file');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 10000,
  socketTimeoutMS: 45000,
})
.then(() => {
  const dbName = mongoose.connection.db.databaseName;
  console.log(`[mongodb] ✓ Connected to database: ${dbName}`);
})
.catch(err => {
  console.error('[mongodb] ✗ Connection FAILED:', err.message);
  process.exit(1);
});

mongoose.connection.on('disconnected', () => console.warn('[mongodb] Disconnected'));
mongoose.connection.on('reconnected',  () => console.log('[mongodb] Reconnected'));

// ─────────────────────────────────────────────────────────────
//  SCHEMAS & MODELS
// ─────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#4f8ef7','#a78bfa','#34d399','#f87171','#fbbf24','#fb923c','#38bdf8','#f472b6'];

const userSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
  username:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:    { type: String, required: true, select: false },
  userType:    { type: String, enum: ['deaf','mute','deafmute','hearing'], default: 'hearing' },
  avatarColor: { type: String, default: '#4f8ef7' },
  bio:         { type: String, default: '' },
  isOnline:    { type: Boolean, default: false },
  lastSeen:    { type: Date, default: Date.now },
  createdAt:   { type: Date, default: Date.now },
}, { versionKey: false });

userSchema.set('toJSON', {
  transform(doc, ret) { delete ret.password; return ret; }
});

const contactSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  addedAt:   { type: Date, default: Date.now },
}, { versionKey: false });
contactSchema.index({ userId: 1, contactId: 1 }, { unique: true });

const messageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  from:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content:   { type: String, required: true },
  type:      { type: String, enum: ['text','sign','voice'], default: 'text' },
  signLabel: { type: String, default: '' },
  read:      { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
}, { versionKey: false });

const User    = mongoose.model('User',    userSchema);
const Contact = mongoose.model('Contact', contactSchema);
const Message = mongoose.model('Message', messageSchema);

// ─────────────────────────────────────────────────────────────
//  JWT HELPERS
// ─────────────────────────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET  || 'fallback_secret_change_this';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

const signToken = (userId) =>
  jwt.sign({ id: userId.toString() }, JWT_SECRET, { expiresIn: JWT_EXPIRES });

const verifyToken = (token) =>
  jwt.verify(token, JWT_SECRET);

// Auth middleware
const requireAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const token   = header.split(' ')[1];
    const decoded = verifyToken(token);
    const user    = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User no longer exists' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token. Please login again.' });
  }
};

// Rate limiter for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests, try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ─────────────────────────────────────────────────────────────
//  API ROUTES  — all defined BEFORE static file serving
// ─────────────────────────────────────────────────────────────

// Health check (test: curl http://localhost:5001/health)
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    mongodb:   mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    dbName:    mongoose.connection.db?.databaseName || 'unknown',
    uptime:    Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ── POST /api/auth/signup ──────────────────────────────────────
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  console.log('[signup] body:', JSON.stringify(req.body));
  try {
    const { name, email, password, username, userType } = req.body;

    // Validate required fields
    if (!name || !email || !password || !username) {
      return res.status(400).json({ error: 'Name, email, username and password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return res.status(400).json({ field: 'username', error: 'Username: 3-30 chars, letters/numbers/underscores only' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ field: 'email', error: 'Invalid email address' });
    }

    // Check existing email
    const emailExists = await User.findOne({ email: email.toLowerCase().trim() });
    if (emailExists) return res.status(409).json({ field: 'email', error: 'Email already registered' });

    // Check existing username
    const usernameExists = await User.findOne({ username: username.toLowerCase().trim() });
    if (usernameExists) return res.status(409).json({ field: 'username', error: 'Username already taken' });

    // Hash password
    const hashed = await bcrypt.hash(String(password), 12);

    // Pick avatar color
    const count = await User.countDocuments();
    const color = AVATAR_COLORS[count % AVATAR_COLORS.length];

    // Create user in MongoDB
    const user = await User.create({
      name:        name.trim(),
      email:       email.toLowerCase().trim(),
      username:    username.toLowerCase().trim(),
      password:    hashed,
      userType:    userType || 'hearing',
      avatarColor: color,
    });

    console.log(`[signup] ✓ Created user: ${user.name} (${user.email}) id=${user._id}`);

    const token = signToken(user._id);
    return res.status(201).json({ token, user });

  } catch (err) {
    console.error('[signup] ERROR:', err.message, err.stack);
    // Handle MongoDB duplicate key error
    if (err.code === 11000) {
      const field = Object.keys(err.keyPattern)[0];
      return res.status(409).json({ field, error: `${field} already exists` });
    }
    return res.status(500).json({ error: 'Signup failed: ' + err.message });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  console.log('[login] attempt:', req.body?.email);
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      return res.status(401).json({ field: 'email', error: 'No account found with this email' });
    }

    const match = await bcrypt.compare(String(password), user.password);
    if (!match) {
      return res.status(401).json({ field: 'password', error: 'Incorrect password' });
    }

    // Update online status
    user.isOnline = true;
    user.lastSeen = new Date();
    await user.save();

    const token = signToken(user._id);
    console.log(`[login] ✓ ${user.name}`);
    return res.json({ token, user });

  } catch (err) {
    console.error('[login] ERROR:', err.message);
    return res.status(500).json({ error: 'Login failed: ' + err.message });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ── PATCH /api/auth/profile ────────────────────────────────────
app.patch('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const { name, bio } = req.body;
    const updates = {};
    if (name && name.trim().length >= 2) updates.name = name.trim();
    if (bio !== undefined) updates.bio = String(bio).slice(0, 300);
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

// ── GET /api/users/search?q= ───────────────────────────────────
app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [{ name: regex }, { username: regex }, { email: regex }],
    }).limit(20).select('_id name username email userType avatarColor bio isOnline lastSeen');
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: 'Search failed: ' + err.message });
  }
});

// ── GET /api/users/:id ─────────────────────────────────────────
app.get('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('_id name username email userType avatarColor bio isOnline lastSeen');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user });
  } catch {
    return res.status(404).json({ error: 'User not found' });
  }
});

// ── GET /api/contacts ──────────────────────────────────────────
app.get('/api/contacts', requireAuth, async (req, res) => {
  try {
    const contacts = await Contact.find({ userId: req.user._id })
      .populate('contactId', '_id name username email userType avatarColor bio isOnline lastSeen')
      .sort({ addedAt: -1 });
    return res.json({ contacts: contacts.map(c => c.contactId).filter(Boolean) });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load contacts: ' + err.message });
  }
});

// ── POST /api/contacts ─────────────────────────────────────────
app.post('/api/contacts', requireAuth, async (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });
    if (String(contactId) === String(req.user._id)) return res.status(400).json({ error: 'Cannot add yourself' });
    const target = await User.findById(contactId);
    if (!target) return res.status(404).json({ error: 'User not found' });
    await Promise.all([
      Contact.findOneAndUpdate(
        { userId: req.user._id, contactId },
        { userId: req.user._id, contactId },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ),
      Contact.findOneAndUpdate(
        { userId: contactId, contactId: req.user._id },
        { userId: contactId, contactId: req.user._id },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ),
    ]);
    console.log(`[contacts] ${req.user.name} ↔ ${target.name}`);
    return res.status(201).json({ message: 'Contact added', contact: target });
  } catch (err) {
    return res.status(500).json({ error: 'Could not add contact: ' + err.message });
  }
});

// ── DELETE /api/contacts/:contactId ───────────────────────────
app.delete('/api/contacts/:contactId', requireAuth, async (req, res) => {
  try {
    await Contact.deleteOne({ userId: req.user._id, contactId: req.params.contactId });
    return res.json({ message: 'Removed' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/messages/:contactId ──────────────────────────────
app.get('/api/messages/:contactId', requireAuth, async (req, res) => {
  try {
    const convId = [req.user._id.toString(), req.params.contactId].sort().join(':');
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 50;
    const msgs   = await Message.find({ conversationId: convId })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    // Mark as read
    await Message.updateMany(
      { conversationId: convId, to: req.user._id, read: false },
      { read: true }
    );
    return res.json({ messages: msgs.reverse() });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load messages: ' + err.message });
  }
});

// ── POST /api/messages ─────────────────────────────────────────
app.post('/api/messages', requireAuth, async (req, res) => {
  try {
    const { toId, content, type, signLabel } = req.body;
    if (!toId || !content) return res.status(400).json({ error: 'toId and content required' });
    const convId = [req.user._id.toString(), toId].sort().join(':');
    const msg = await Message.create({
      conversationId: convId,
      from:      req.user._id,
      to:        toId,
      content:   String(content).trim(),
      type:      type || 'text',
      signLabel: signLabel || '',
    });
    // Notify recipient if online via Socket.io
    const recipientSocket = onlineUsers.get(toId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('new_message', {
        ...msg.toObject(),
        from: { _id: req.user._id, name: req.user.name, avatarColor: req.user.avatarColor },
      });
    }
    return res.status(201).json({ message: msg });
  } catch (err) {
    return res.status(500).json({ error: 'Send failed: ' + err.message });
  }
});

// ── GET /api/messages/unread/count ────────────────────────────
app.get('/api/messages/unread/count', requireAuth, async (req, res) => {
  try {
    const count = await Message.countDocuments({ to: req.user._id, read: false });
    return res.json({ count });
  } catch {
    return res.status(500).json({ error: 'Count failed' });
  }
});

// ─────────────────────────────────────────────────────────────
//  STATIC FILES  — AFTER all API routes
// ─────────────────────────────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR, {
  index: false,  // Don't auto-serve index.html (we handle it below)
  maxAge: '1d',
}));

// Serve HTML pages explicitly
app.get('/',         (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
app.get('/app',      (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'app.html')));
app.get('/call',     (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'call.html')));
app.get('/app.html', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'app.html')));
app.get('/call.html',(req, res) => res.sendFile(path.join(FRONTEND_DIR, 'call.html')));
app.get('/index.html',(req,res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));

// 404 for unknown routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  }
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ─────────────────────────────────────────────────────────────
//  SOCKET.IO — Real-time signaling
// ─────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingTimeout:  60000,
  pingInterval: 25000,
});

// Track online users and rooms
const onlineUsers = new Map(); // userId → socketId
const rooms       = new Map(); // roomId → Set<socketId>
const socketMeta  = new Map(); // socketId → { userId, userName, roomId }

// Authenticate socket connections with JWT
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('No token'));
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Auth failed'));
  }
});

io.on('connection', async (socket) => {
  const user = socket.user;
  console.log(`[socket+] ${user.name} (${socket.id})`);

  onlineUsers.set(user._id.toString(), socket.id);
  await User.findByIdAndUpdate(user._id, { isOnline: true, lastSeen: new Date() });
  broadcastPresence(user._id.toString(), true);

  // ── Call room ───────────────────────────────────────────────
  socket.on('join-room', ({ roomId }) => {
    if (!roomId) return;
    const prev = socketMeta.get(socket.id);
    if (prev?.roomId) leaveRoom(socket, prev.roomId);
    socket.join(roomId);
    socketMeta.set(socket.id, { userId: user._id.toString(), userName: user.name, roomId });
    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socket.id);
    const peers = [...rooms.get(roomId)].filter(id => id !== socket.id).map(id => {
      const m = socketMeta.get(id);
      return { socketId: id, userId: m?.userId, userName: m?.userName };
    });
    console.log(`[room:${roomId}] ${user.name} joined, peers: ${peers.length}`);
    socket.emit('room-peers', { peers });
    socket.to(roomId).emit('peer-joined', { socketId: socket.id, userId: user._id.toString(), userName: user.name });
  });

  // ── WebRTC signaling relay ──────────────────────────────────
  socket.on('webrtc-offer',  ({ targetSocketId, sdp }) => io.to(targetSocketId).emit('webrtc-offer',  { sdp, fromSocketId: socket.id, fromUserId: user._id.toString(), fromUserName: user.name }));
  socket.on('webrtc-answer', ({ targetSocketId, sdp }) => io.to(targetSocketId).emit('webrtc-answer', { sdp, fromSocketId: socket.id }));
  socket.on('webrtc-ice',    ({ targetSocketId, candidate }) => io.to(targetSocketId).emit('webrtc-ice', { candidate, fromSocketId: socket.id }));

  // ── Feature events ──────────────────────────────────────────
  socket.on('sign_caption',  d => socket.to(d.roomId).emit('sign_caption',  { ...d, fromSocketId: socket.id }));
  socket.on('speech_caption',d => socket.to(d.roomId).emit('speech_caption',{ ...d, fromSocketId: socket.id }));
  socket.on('call_control',  d => socket.to(d.roomId).emit('call_control',  { ...d, fromSocketId: socket.id }));
  socket.on('screen_share',  d => socket.to(d.roomId).emit('screen_share',  { ...d, fromSocketId: socket.id }));
  socket.on('call_end', ({ roomId }) => {
    socket.to(roomId).emit('call_ended', { fromSocketId: socket.id });
    leaveRoom(socket, roomId);
  });
  socket.on('typing', ({ toUserId, isTyping }) => {
    const r = onlineUsers.get(toUserId);
    if (r) io.to(r).emit('typing', { fromUserId: user._id.toString(), fromName: user.name, isTyping });
  });

  // ── Disconnect ──────────────────────────────────────────────
  socket.on('disconnect', async () => {
    console.log(`[socket-] ${user.name}`);
    onlineUsers.delete(user._id.toString());
    await User.findByIdAndUpdate(user._id, { isOnline: false, lastSeen: new Date() });
    const meta = socketMeta.get(socket.id);
    if (meta?.roomId) {
      socket.to(meta.roomId).emit('peer-left', { socketId: socket.id, userId: meta.userId, userName: meta.userName });
      leaveRoom(socket, meta.roomId);
    }
    socketMeta.delete(socket.id);
    broadcastPresence(user._id.toString(), false);
  });

  async function broadcastPresence(userId, isOnline) {
    try {
      const contacts = await Contact.find({ userId }).select('contactId');
      contacts.forEach(c => {
        const sid = onlineUsers.get(c.contactId.toString());
        if (sid) io.to(sid).emit('presence', { userId, isOnline, lastSeen: new Date() });
      });
    } catch {}
  }

  function leaveRoom(sock, roomId) {
    sock.leave(roomId);
    const room = rooms.get(roomId);
    if (room) { room.delete(sock.id); if (room.size === 0) rooms.delete(roomId); }
    const meta = socketMeta.get(sock.id);
    if (meta) socketMeta.set(sock.id, { ...meta, roomId: null });
  }
});

// ─────────────────────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n✋ sign_call server started');
  console.log(`   Port    : ${PORT}`);
  console.log(`   URL     : http://0.0.0.0:${PORT}`);
  console.log(`   Health  : http://0.0.0.0:${PORT}/health`);
  console.log(`   Env     : ${process.env.NODE_ENV || 'development'}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message);
});
