'use strict';
/**
 * sign_call — Main Server
 * ─────────────────────────────────────────────────────────────
 * Express REST API  +  Socket.io signaling  +  MongoDB storage
 *
 * Data flow:
 *   signup/login  → MongoDB users collection (bcrypt hashed passwords)
 *   contacts      → MongoDB contacts collection
 *   messages      → MongoDB messages collection
 *   video call    → WebRTC via Socket.io signaling (P2P, not stored)
 *   online status → Socket.io in-memory (fast)
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

// ── Security middleware ────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off so inline scripts work
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10kb' }));

// Rate limiting on auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 min
  max: 20,
  message: { error: 'Too many attempts, try again later.' },
});

// ── MongoDB connection ─────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/sign_call';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('[mongodb] connected:', MONGODB_URI))
  .catch(err => {
    console.error('[mongodb] connection failed:', err.message);
    console.error('Start MongoDB: sudo systemctl start mongod');
  });

// ══════════════════════════════════════════════════════════════
//  MONGOOSE SCHEMAS & MODELS
// ══════════════════════════════════════════════════════════════

// ── User Schema ────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  name:         { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  email:        { type: String, required: true, unique: true, lowercase: true, trim: true },
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 30 },
  password:     { type: String, required: true, select: false },   // never returned in queries
  userType:     { type: String, enum: ['deaf','mute','deafmute','hearing'], default: 'hearing' },
  avatarColor:  { type: String, default: '#4f8ef7' },
  bio:          { type: String, default: '', maxlength: 300 },
  isOnline:     { type: Boolean, default: false },
  lastSeen:     { type: Date, default: Date.now },
  createdAt:    { type: Date, default: Date.now },
}, { versionKey: false });

// Strip password from all JSON output
userSchema.set('toJSON', {
  transform(doc, ret) { delete ret.password; return ret; }
});

const User = mongoose.model('User', userSchema);

// ── Contact Schema ─────────────────────────────────────────────
const contactSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contactId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  addedAt:    { type: Date, default: Date.now },
}, { versionKey: false });

// Unique pair so no duplicate contacts
contactSchema.index({ userId: 1, contactId: 1 }, { unique: true });

const Contact = mongoose.model('Contact', contactSchema);

// ── Message Schema ─────────────────────────────────────────────
const messageSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, index: true },
  from:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  to:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content:{ type: String, required: true, maxlength: 5000 },
  type:   { type: String, enum: ['text','sign','voice'], default: 'text' },
  signLabel: { type: String, default: '' },
  read:   { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now },
}, { versionKey: false });

const Message = mongoose.model('Message', messageSchema);

// ── JWT helpers ────────────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET  || 'CHANGE_THIS_SECRET_IN_PRODUCTION';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '7d';

function signToken(userId) {
  return jwt.sign({ id: userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ── Auth middleware ────────────────────────────────────────────
async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
    const token = header.split(' ')[1];
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Avatar colour pool
const AVATAR_COLORS = ['#4f8ef7','#a78bfa','#34d399','#f87171','#fbbf24','#fb923c','#38bdf8','#f472b6','#818cf8','#6ee7b7'];

// ══════════════════════════════════════════════════════════════
//  REST API ROUTES
// ══════════════════════════════════════════════════════════════

// ── POST /api/auth/signup ──────────────────────────────────────
app.post('/api/auth/signup', authLimiter, async (req, res) => {
  try {
    const { name, email, password, username, userType } = req.body;

    if (!name || !email || !password || !username) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!/^[a-z0-9_]{3,30}$/i.test(username)) {
      return res.status(400).json({ error: 'Username: 3-30 chars, letters/numbers/underscores only' });
    }

    // Check uniqueness
    const [emailExists, usernameExists] = await Promise.all([
      User.findOne({ email:    email.toLowerCase() }),
      User.findOne({ username: username.toLowerCase() }),
    ]);
    if (emailExists)    return res.status(409).json({ field: 'email',    error: 'Email already registered' });
    if (usernameExists) return res.status(409).json({ field: 'username', error: 'Username already taken' });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    const userCount = await User.countDocuments();
    const color = AVATAR_COLORS[userCount % AVATAR_COLORS.length];

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      username: username.toLowerCase().trim(),
      password: hashedPassword,
      userType: userType || 'hearing',
      avatarColor: color,
    });

    const token = signToken(user._id);
    console.log(`[signup] ${user.name} (${user.email})`);

    return res.status(201).json({
      token,
      user: {
        _id: user._id, id: user._id,
        name: user.name, email: user.email,
        username: user.username, userType: user.userType,
        avatarColor: user.avatarColor, bio: user.bio,
      }
    });
  } catch (err) {
    console.error('[signup error]', err.message);
    return res.status(500).json({ error: 'Signup failed: ' + err.message });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────
app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) return res.status(401).json({ field: 'email', error: 'No account found with this email' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ field: 'password', error: 'Incorrect password' });

    // Mark online
    await User.findByIdAndUpdate(user._id, { isOnline: true, lastSeen: new Date() });

    const token = signToken(user._id);
    console.log(`[login] ${user.name}`);

    return res.json({
      token,
      user: {
        _id: user._id, id: user._id,
        name: user.name, email: user.email,
        username: user.username, userType: user.userType,
        avatarColor: user.avatarColor, bio: user.bio,
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Login failed' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────
app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({ user: req.user });
});

// ── PATCH /api/auth/profile ────────────────────────────────────
app.patch('/api/auth/profile', requireAuth, async (req, res) => {
  try {
    const { name, bio } = req.body;
    const updates = {};
    if (name && name.trim().length >= 2) updates.name = name.trim();
    if (bio !== undefined) updates.bio = bio.trim().slice(0, 300);
    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Update failed' });
  }
});

// ── GET /api/users/search?q=query ─────────────────────────────
// Search for users by name, username, or email (for adding contacts)
app.get('/api/users/search', requireAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });

    const regex = new RegExp(q, 'i');
    const users = await User.find({
      _id:  { $ne: req.user._id },          // exclude self
      $or:  [{ name: regex }, { username: regex }, { email: regex }],
    }).limit(20).select('_id name username email userType avatarColor bio isOnline lastSeen');

    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: 'Search failed' });
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
    const users = contacts.map(c => c.contactId).filter(Boolean);
    return res.json({ contacts: users });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load contacts' });
  }
});

// ── POST /api/contacts ─────────────────────────────────────────
app.post('/api/contacts', requireAuth, async (req, res) => {
  try {
    const { contactId } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });
    if (contactId === req.user._id.toString()) return res.status(400).json({ error: 'Cannot add yourself' });

    const target = await User.findById(contactId);
    if (!target) return res.status(404).json({ error: 'User not found' });

    // Add both directions so both can see each other
    await Promise.all([
      Contact.findOneAndUpdate(
        { userId: req.user._id, contactId },
        { userId: req.user._id, contactId },
        { upsert: true, new: true }
      ),
      Contact.findOneAndUpdate(
        { userId: contactId, contactId: req.user._id },
        { userId: contactId, contactId: req.user._id },
        { upsert: true, new: true }
      ),
    ]);

    console.log(`[contacts] ${req.user.name} ↔ ${target.name}`);
    return res.status(201).json({ message: 'Contact added', contact: target });
  } catch (err) {
    return res.status(500).json({ error: 'Could not add contact' });
  }
});

// ── DELETE /api/contacts/:contactId ───────────────────────────
app.delete('/api/contacts/:contactId', requireAuth, async (req, res) => {
  try {
    await Contact.deleteOne({ userId: req.user._id, contactId: req.params.contactId });
    return res.json({ message: 'Contact removed' });
  } catch {
    return res.status(500).json({ error: 'Could not remove contact' });
  }
});

// ── GET /api/messages/:contactId ──────────────────────────────
app.get('/api/messages/:contactId', requireAuth, async (req, res) => {
  try {
    const convId = [req.user._id.toString(), req.params.contactId].sort().join(':');
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip  = (page - 1) * limit;

    const messages = await Message.find({ conversationId: convId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Mark unread messages as read
    await Message.updateMany(
      { conversationId: convId, to: req.user._id, read: false },
      { read: true }
    );

    return res.json({ messages: messages.reverse() });
  } catch (err) {
    return res.status(500).json({ error: 'Could not load messages' });
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
      content:   content.trim(),
      type:      type || 'text',
      signLabel: signLabel || '',
    });

    // Notify recipient via Socket.io if online
    const recipientSocketId = onlineUsers.get(toId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('new_message', {
        ...msg.toObject(),
        from: { _id: req.user._id, name: req.user.name, avatarColor: req.user.avatarColor },
      });
    }

    return res.status(201).json({ message: msg });
  } catch (err) {
    return res.status(500).json({ error: 'Could not send message' });
  }
});

// ── GET /api/messages/unread/count ────────────────────────────
app.get('/api/messages/unread/count', requireAuth, async (req, res) => {
  try {
    const count = await Message.countDocuments({ to: req.user._id, read: false });
    return res.json({ count });
  } catch {
    return res.status(500).json({ error: 'Could not count unread' });
  }
});

// ── Serve frontend static files ────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR));

// Catch-all — must be AFTER all API routes
app.get('*', (req, res) => {
  // Don't catch API routes
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found' });
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ══════════════════════════════════════════════════════════════
//  SOCKET.IO — Signaling + Real-time notifications
// ══════════════════════════════════════════════════════════════
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] },
  pingTimeout:  60000,
  pingInterval: 25000,
});

// Online users: userId(string) → socketId
const onlineUsers = new Map();
// Call rooms:   roomId → Set of socketIds
const rooms       = new Map();
// Socket meta:  socketId → { userId, userName, roomId }
const socketMeta  = new Map();

// Socket.io JWT auth middleware
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) return next(new Error('Authentication required'));
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id);
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const user = socket.user;
  console.log(`[+] ${user.name} connected (${socket.id})`);

  // Mark user online in DB + memory
  onlineUsers.set(user._id.toString(), socket.id);
  await User.findByIdAndUpdate(user._id, { isOnline: true, lastSeen: new Date() });

  // Broadcast online status to all contacts
  broadcastPresence(user._id.toString(), true);

  // ── Call room management ──────────────────────────────────
  socket.on('join-room', ({ roomId }) => {
    if (!roomId) return;
    const prev = socketMeta.get(socket.id);
    if (prev?.roomId) leaveRoom(socket, prev.roomId);

    socket.join(roomId);
    socketMeta.set(socket.id, { userId: user._id.toString(), userName: user.name, roomId });

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socket.id);

    const peers = [...rooms.get(roomId)]
      .filter(id => id !== socket.id)
      .map(id => {
        const m = socketMeta.get(id);
        return { socketId: id, userId: m?.userId, userName: m?.userName };
      });

    console.log(`[room:${roomId}] ${user.name} joined. Peers: ${peers.length}`);
    socket.emit('room-peers', { peers });
    socket.to(roomId).emit('peer-joined', { socketId: socket.id, userId: user._id.toString(), userName: user.name });
  });

  // ── WebRTC signaling ──────────────────────────────────────
  socket.on('webrtc-offer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('webrtc-offer', { sdp, fromSocketId: socket.id, fromUserId: user._id.toString(), fromUserName: user.name });
  });

  socket.on('webrtc-answer', ({ targetSocketId, sdp }) => {
    io.to(targetSocketId).emit('webrtc-answer', { sdp, fromSocketId: socket.id });
  });

  socket.on('webrtc-ice', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice', { candidate, fromSocketId: socket.id });
  });

  // ── Feature events ────────────────────────────────────────
  socket.on('sign_caption', (data) => {
    socket.to(data.roomId).emit('sign_caption', { ...data, fromSocketId: socket.id });
  });

  socket.on('speech_caption', (data) => {
    socket.to(data.roomId).emit('speech_caption', { ...data, fromSocketId: socket.id });
  });

  socket.on('call_control', (data) => {
    socket.to(data.roomId).emit('call_control', { ...data, fromSocketId: socket.id });
  });

  socket.on('screen_share', (data) => {
    socket.to(data.roomId).emit('screen_share', { ...data, fromSocketId: socket.id });
  });

  socket.on('call_end', ({ roomId }) => {
    socket.to(roomId).emit('call_ended', { fromSocketId: socket.id });
    leaveRoom(socket, roomId);
  });

  // ── Typing indicator ──────────────────────────────────────
  socket.on('typing', ({ toUserId, isTyping }) => {
    const recipientSocket = onlineUsers.get(toUserId);
    if (recipientSocket) {
      io.to(recipientSocket).emit('typing', { fromUserId: user._id.toString(), fromName: user.name, isTyping });
    }
  });

  // ── Disconnect ────────────────────────────────────────────
  socket.on('disconnect', async (reason) => {
    console.log(`[-] ${user.name} disconnected (${reason})`);
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

  // ── Helpers ───────────────────────────────────────────────
  async function broadcastPresence(userId, isOnline) {
    // Tell all this user's contacts about their online status
    try {
      const contacts = await Contact.find({ userId }).select('contactId');
      contacts.forEach(c => {
        const cSocketId = onlineUsers.get(c.contactId.toString());
        if (cSocketId) {
          io.to(cSocketId).emit('presence', { userId, isOnline, lastSeen: new Date() });
        }
      });
    } catch {}
  }

  function leaveRoom(sock, roomId) {
    sock.leave(roomId);
    const room = rooms.get(roomId);
    if (room) { room.delete(sock.id); if (room.size === 0) rooms.delete(roomId); }
    const meta = socketMeta.get(sock.id);
    if (meta) { socketMeta.set(sock.id, { ...meta, roomId: null }); }
  }
});

// ── Health check ───────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  onlineUsers: onlineUsers.size,
  activeRooms: rooms.size,
  uptime: Math.round(process.uptime()),
}));

// ── Start server ───────────────────────────────────────────────
const PORT = process.env.PORT || 5001;
server.listen(PORT, '0.0.0.0', () => {
  const dbName = (process.env.MONGODB_URI || '').split('/').pop()?.split('?')[0] || 'sign_call';
  console.log(`\n✋ sign_call server running`);
  console.log(`   URL      : http://0.0.0.0:${PORT}`);
  console.log(`   Health   : http://0.0.0.0:${PORT}/health`);
  console.log(`   Database : ${dbName} (MongoDB Atlas)`);
  console.log(`   Static   : ${FRONTEND_DIR}\n`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
