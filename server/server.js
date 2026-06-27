/**
 * SignConnect — WebRTC Signaling Server
 * server.js
 *
 * Runs on AWS EC2. Serves the static frontend files AND
 * handles WebRTC signaling via Socket.io so two browsers
 * can establish a real peer-to-peer video call.
 *
 * Flow:
 *  1. User A joins a room (roomId = sorted pair of userIds)
 *  2. Server notifies User B that someone wants to call
 *  3. User B accepts → joins the same room
 *  4. Server relays SDP offer/answer + ICE candidates between them
 *  5. WebRTC peer connection established → live video/audio
 *
 * ALSO relays:
 *  - sign_caption  : detected gesture text from one peer to other
 *  - speech_caption: speech-to-text from one peer to other
 *  - chat_message  : in-call text messages
 *  - call_end      : hang-up signal
 */

'use strict';

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const cors      = require('cors');
const path      = require('path');

const app    = express();
const server = http.createServer(app);

// ── CORS — allow all origins (tighten in production if needed) ──
app.use(cors({ origin: '*' }));
app.use(express.json());

// ── Serve frontend static files from parent directory ──────────
const FRONTEND_DIR = path.join(__dirname, '..');
app.use(express.static(FRONTEND_DIR));

// ── Catch-all: serve index.html for unknown routes ─────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ── Socket.io signaling server ──────────────────────────────────
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000,
});

// Track rooms: roomId → Set of socket IDs
const rooms = new Map();
// Track users: socketId → { userId, userName, roomId }
const socketUsers = new Map();

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  // ── join-room ───────────────────────────────────────────────
  // Called when a user starts or accepts a call
  // data: { roomId, userId, userName }
  socket.on('join-room', ({ roomId, userId, userName }) => {
    if (!roomId || !userId) return;

    // Leave any previous room
    const prev = socketUsers.get(socket.id);
    if (prev?.roomId) leaveRoom(socket, prev.roomId);

    socket.join(roomId);
    socketUsers.set(socket.id, { userId, userName, roomId });

    if (!rooms.has(roomId)) rooms.set(roomId, new Set());
    rooms.get(roomId).add(socket.id);

    const peers = [...rooms.get(roomId)].filter(id => id !== socket.id);
    console.log(`[room:${roomId}] ${userName} joined. Peers: ${peers.length}`);

    // Tell the joiner who else is already in the room
    socket.emit('room-peers', {
      peers: peers.map(id => {
        const u = socketUsers.get(id);
        return { socketId: id, userId: u?.userId, userName: u?.userName };
      })
    });

    // Tell existing peers a new user joined
    socket.to(roomId).emit('peer-joined', {
      socketId: socket.id,
      userId,
      userName,
    });
  });

  // ── WebRTC signaling relay ──────────────────────────────────
  // Each of these events is forwarded to the target socket

  // Offer: { targetSocketId, sdp }
  socket.on('webrtc-offer', ({ targetSocketId, sdp }) => {
    const sender = socketUsers.get(socket.id);
    console.log(`[webrtc] offer from ${sender?.userName} → ${targetSocketId}`);
    io.to(targetSocketId).emit('webrtc-offer', {
      sdp,
      fromSocketId: socket.id,
      fromUserId:   sender?.userId,
      fromUserName: sender?.userName,
    });
  });

  // Answer: { targetSocketId, sdp }
  socket.on('webrtc-answer', ({ targetSocketId, sdp }) => {
    const sender = socketUsers.get(socket.id);
    console.log(`[webrtc] answer from ${sender?.userName} → ${targetSocketId}`);
    io.to(targetSocketId).emit('webrtc-answer', {
      sdp,
      fromSocketId: socket.id,
    });
  });

  // ICE candidate: { targetSocketId, candidate }
  socket.on('webrtc-ice', ({ targetSocketId, candidate }) => {
    io.to(targetSocketId).emit('webrtc-ice', {
      candidate,
      fromSocketId: socket.id,
    });
  });

  // ── Feature events (relayed to room) ───────────────────────

  // Sign language caption: { roomId, gesture, confidence, userName }
  socket.on('sign_caption', (data) => {
    socket.to(data.roomId).emit('sign_caption', {
      ...data,
      fromSocketId: socket.id,
    });
  });

  // Speech caption: { roomId, text, isFinal, userName }
  socket.on('speech_caption', (data) => {
    socket.to(data.roomId).emit('speech_caption', {
      ...data,
      fromSocketId: socket.id,
    });
  });

  // In-call chat message: { roomId, text, userName, timestamp }
  socket.on('chat_message', (data) => {
    socket.to(data.roomId).emit('chat_message', {
      ...data,
      fromSocketId: socket.id,
    });
  });

  // Call control: mute/cam toggle notification
  socket.on('call_control', (data) => {
    socket.to(data.roomId).emit('call_control', {
      ...data,
      fromSocketId: socket.id,
    });
  });

  // Screen share status
  socket.on('screen_share', (data) => {
    socket.to(data.roomId).emit('screen_share', {
      ...data,
      fromSocketId: socket.id,
    });
  });

  // Call end
  socket.on('call_end', ({ roomId }) => {
    console.log(`[call_end] room ${roomId}`);
    socket.to(roomId).emit('call_ended', { fromSocketId: socket.id });
    leaveRoom(socket, roomId);
  });

  // ── Disconnect ──────────────────────────────────────────────
  socket.on('disconnect', (reason) => {
    console.log(`[-] Socket disconnected: ${socket.id} (${reason})`);
    const user = socketUsers.get(socket.id);
    if (user?.roomId) {
      socket.to(user.roomId).emit('peer-left', {
        socketId: socket.id,
        userId: user.userId,
        userName: user.userName,
      });
      leaveRoom(socket, user.roomId);
    }
    socketUsers.delete(socket.id);
  });

  // ── Helpers ─────────────────────────────────────────────────
  function leaveRoom(sock, roomId) {
    sock.leave(roomId);
    const room = rooms.get(roomId);
    if (room) {
      room.delete(sock.id);
      if (room.size === 0) rooms.delete(roomId);
    }
  }
});

// ── Health check endpoint ───────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok',
  rooms:  rooms.size,
  sockets: io.engine.clientsCount,
  uptime: Math.round(process.uptime()),
}));

// ── Start server ────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✋ sign_call server running`);
  console.log(`   URL    : http://0.0.0.0:${PORT}`);
  console.log(`   Health : http://0.0.0.0:${PORT}/health`);
  console.log(`   Static : ${FRONTEND_DIR}`);
  console.log(`   Mode   : ${process.env.NODE_ENV || 'development'}\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down...');
  server.close(() => process.exit(0));
});
