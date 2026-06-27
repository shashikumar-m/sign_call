/**
 * SignConnect — localStorage Database Layer
 * db.js
 *
 * Provides a simple CRUD interface over localStorage.
 * All data is namespaced under "sc_" prefix.
 * NO hardcoded data — all records created at runtime.
 */

const DB = (() => {
  // ── Keys ──────────────────────────────────────────────────────
  const KEYS = {
    USERS:    'sc_users',
    CONTACTS: 'sc_contacts',   // { userId: [contactUserId, ...] }
    MESSAGES: 'sc_messages',   // { conversationId: [message, ...] }
    SETTINGS: 'sc_settings',
    PRESENCE: 'sc_presence',   // { userId: { status, lastSeen } }
  };

  // ── Helpers ───────────────────────────────────────────────────
  const read  = key => JSON.parse(localStorage.getItem(key) || 'null');
  const write = (key, val) => localStorage.setItem(key, JSON.stringify(val));
  const uid   = () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;

  // ── Users ─────────────────────────────────────────────────────
  const Users = {
    getAll() {
      return read(KEYS.USERS) || {};
    },

    get(userId) {
      const users = this.getAll();
      return users[userId] || null;
    },

    findByEmail(email) {
      const users = this.getAll();
      return Object.values(users).find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
    },

    findByUsername(username) {
      const users = this.getAll();
      return Object.values(users).find(u =>
        u.username && u.username.toLowerCase() === username.toLowerCase()
      ) || null;
    },

    search(query) {
      const q = query.toLowerCase();
      const users = this.getAll();
      return Object.values(users).filter(u =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.username && u.username.toLowerCase().includes(q))
      );
    },

    create(data) {
      const users = this.getAll();
      const id = uid();
      const avatarColors = ['#4f8ef7','#a78bfa','#34d399','#f87171','#fbbf24','#fb923c','#38bdf8','#f472b6'];
      const user = {
        id,
        name:      data.name.trim(),
        email:     data.email.toLowerCase().trim(),
        username:  data.username ? data.username.toLowerCase().trim() : data.email.split('@')[0],
        password:  btoa(data.password),   // simple obfuscation (not real hash)
        userType:  data.userType || 'hearing',
        avatarColor: avatarColors[Object.keys(users).length % avatarColors.length],
        bio:       data.bio || '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      users[id] = user;
      write(KEYS.USERS, users);
      return user;
    },

    update(userId, updates) {
      const users = this.getAll();
      if (!users[userId]) return null;
      users[userId] = { ...users[userId], ...updates, updatedAt: Date.now() };
      write(KEYS.USERS, users);
      return users[userId];
    },

    verify(email, password) {
      const user = this.findByEmail(email);
      if (!user) return null;
      if (user.password !== btoa(password)) return null;
      return user;
    },

    publicProfile(user) {
      if (!user) return null;
      const { password: _, ...pub } = user; // strip password
      return pub;
    }
  };

  // ── Contacts ──────────────────────────────────────────────────
  const Contacts = {
    getForUser(userId) {
      const all = read(KEYS.CONTACTS) || {};
      const ids = all[userId] || [];
      return ids.map(id => Users.publicProfile(Users.get(id))).filter(Boolean);
    },

    add(userId, contactId) {
      if (userId === contactId) return false;
      const all = read(KEYS.CONTACTS) || {};
      if (!all[userId]) all[userId] = [];
      if (all[userId].includes(contactId)) return false;
      all[userId].push(contactId);
      write(KEYS.CONTACTS, all);
      // Also add reverse
      if (!all[contactId]) all[contactId] = [];
      if (!all[contactId].includes(userId)) all[contactId].push(userId);
      write(KEYS.CONTACTS, all);
      return true;
    },

    remove(userId, contactId) {
      const all = read(KEYS.CONTACTS) || {};
      if (all[userId]) all[userId] = all[userId].filter(id => id !== contactId);
      write(KEYS.CONTACTS, all);
    },

    isContact(userId, contactId) {
      const all = read(KEYS.CONTACTS) || {};
      return (all[userId] || []).includes(contactId);
    }
  };

  // ── Messages ──────────────────────────────────────────────────
  const Messages = {
    /** Canonical conversation ID (sorted user IDs joined by ":") */
    convId(userId1, userId2) {
      return [userId1, userId2].sort().join(':');
    },

    getConversation(userId1, userId2) {
      const all = read(KEYS.MESSAGES) || {};
      return all[this.convId(userId1, userId2)] || [];
    },

    send(fromId, toId, content, type = 'text') {
      const all  = read(KEYS.MESSAGES) || {};
      const cid  = this.convId(fromId, toId);
      const msgs = all[cid] || [];
      const msg  = {
        id:        uid(),
        from:      fromId,
        to:        toId,
        content,
        type,      // 'text' | 'sign' | 'voice'
        timestamp: Date.now(),
        read:      false,
      };
      msgs.push(msg);
      all[cid] = msgs;
      write(KEYS.MESSAGES, all);
      return msg;
    },

    markRead(userId1, userId2, readerUserId) {
      const all = read(KEYS.MESSAGES) || {};
      const cid = this.convId(userId1, userId2);
      if (!all[cid]) return;
      all[cid] = all[cid].map(m => {
        if (m.to === readerUserId && !m.read) return { ...m, read: true };
        return m;
      });
      write(KEYS.MESSAGES, all);
    },

    unreadCount(userId, contactId) {
      const msgs = this.getConversation(userId, contactId);
      return msgs.filter(m => m.to === userId && !m.read).length;
    },

    lastMessage(userId, contactId) {
      const msgs = this.getConversation(userId, contactId);
      return msgs.length ? msgs[msgs.length - 1] : null;
    },

    /** Total unread across all conversations */
    totalUnread(userId) {
      const contacts = Contacts.getForUser(userId);
      return contacts.reduce((sum, c) => sum + this.unreadCount(userId, c.id), 0);
    }
  };

  // ── Settings ──────────────────────────────────────────────────
  const Settings = {
    get(userId) {
      const all = read(KEYS.SETTINGS) || {};
      return all[userId] || {
        theme:         'dark',
        speechLang:    'en-US',
        ttsEnabled:    true,
        sttEnabled:    true,
        signDetectEnabled: true,
        notifySound:   true,
        fontSize:      'medium',
      };
    },

    set(userId, settings) {
      const all = read(KEYS.SETTINGS) || {};
      all[userId] = { ...(all[userId] || {}), ...settings };
      write(KEYS.SETTINGS, all);
    }
  };

  // ── Presence ──────────────────────────────────────────────────
  const Presence = {
    set(userId, status = 'online') {
      const all = read(KEYS.PRESENCE) || {};
      all[userId] = { status, lastSeen: Date.now() };
      write(KEYS.PRESENCE, all);
    },

    get(userId) {
      const all = read(KEYS.PRESENCE) || {};
      return all[userId] || { status: 'offline', lastSeen: 0 };
    },

    setOffline(userId) {
      this.set(userId, 'offline');
    }
  };

  // Public API
  return { Users, Contacts, Messages, Settings, Presence, uid };
})();

// Make globally available
window.DB = DB;
