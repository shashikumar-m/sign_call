/**
 * SignCall — API Client
 * api.js
 *
 * All HTTP calls to the backend REST API.
 * Token is stored in localStorage (persists across tabs/sessions).
 * Every request automatically attaches the Bearer token.
 */

const API = (() => {
  'use strict';

  // Detect server base URL automatically:
  //   - In production: same origin as the page (e.g. http://ec2-ip:3000)
  //   - In local dev: same origin (localhost:3000)
  const BASE = window.location.origin;

  // ── Token management ────────────────────────────────────────
  const TOKEN_KEY = 'sc_token';
  const USER_KEY  = 'sc_user';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY);
  }

  function setSession(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  function getCachedUser() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  }

  function isLoggedIn() {
    return !!getToken() && !!getCachedUser();
  }

  // ── Core fetch wrapper ───────────────────────────────────────
  async function request(method, path, body = null, auth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) {
      const token = getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${BASE}${path}`, opts);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      err.field  = data.field;
      throw err;
    }
    return data;
  }

  const get    = (path)       => request('GET',    path);
  const post   = (path, body) => request('POST',   path, body);
  const patch  = (path, body) => request('PATCH',  path, body);
  const del    = (path)       => request('DELETE', path);

  // ── Auth endpoints ───────────────────────────────────────────
  const Auth = {
    async signup({ name, email, username, password, confirmPassword, userType }) {
      if (password !== confirmPassword) {
        throw Object.assign(new Error('Passwords do not match'), { field: 'confirmPassword' });
      }
      const data = await request('POST', '/api/auth/signup',
        { name, email, username, password, userType }, false);
      setSession(data.token, data.user);
      return data.user;
    },

    async login({ email, password, remember }) {
      const data = await request('POST', '/api/auth/login', { email, password }, false);
      setSession(data.token, data.user);
      return data.user;
    },

    async me() {
      const data = await get('/api/auth/me');
      // Refresh cached user
      if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user;
    },

    async updateProfile(updates) {
      const data = await patch('/api/auth/profile', updates);
      if (data.user) localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data.user;
    },

    logout() {
      clearSession();
      window.location.href = 'index.html';
    },

    requireAuth() {
      if (!isLoggedIn()) { window.location.href = 'index.html'; return null; }
      return getCachedUser();
    },

    redirectIfLoggedIn(dest = 'app.html') {
      if (isLoggedIn()) window.location.href = dest;
    },

    isLoggedIn,
    getToken,
    getCachedUser,
  };

  // ── Users endpoints ──────────────────────────────────────────
  const Users = {
    async search(query) {
      if (!query || query.length < 2) return [];
      const data = await get(`/api/users/search?q=${encodeURIComponent(query)}`);
      return data.users || [];
    },

    async getById(id) {
      const data = await get(`/api/users/${id}`);
      return data.user;
    },
  };

  // ── Contacts endpoints ───────────────────────────────────────
  const Contacts = {
    async getAll() {
      const data = await get('/api/contacts');
      return data.contacts || [];
    },

    async add(contactId) {
      const data = await post('/api/contacts', { contactId });
      return data.contact;
    },

    async remove(contactId) {
      await del(`/api/contacts/${contactId}`);
    },
  };

  // ── Messages endpoints ───────────────────────────────────────
  const Messages = {
    async getConversation(contactId, page = 1) {
      const data = await get(`/api/messages/${contactId}?page=${page}&limit=50`);
      return data.messages || [];
    },

    async send(toId, content, type = 'text', signLabel = '') {
      const data = await post('/api/messages', { toId, content, type, signLabel });
      return data.message;
    },

    async unreadCount() {
      const data = await get('/api/messages/unread/count');
      return data.count || 0;
    },
  };

  // ── Format helpers (kept from old ui.js) ─────────────────────
  const Format = {
    initials(name) {
      if (!name) return '?';
      return name.split(' ').slice(0,2).map(w => w[0]).join('').toUpperCase();
    },
    time(ts) {
      if (!ts) return '';
      return new Date(ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    },
    relativeTime(ts) {
      if (!ts) return '';
      const diff = Date.now() - new Date(ts).getTime();
      if (diff < 60000)    return 'just now';
      if (diff < 3600000)  return `${Math.floor(diff/60000)}m ago`;
      if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
      return new Date(ts).toLocaleDateString([], { month:'short', day:'numeric' });
    },
    msgPreview(msg) {
      if (!msg) return '';
      if (msg.type === 'sign')  return `✋ ${msg.content}`;
      if (msg.type === 'voice') return '🎙 Voice note';
      const c = msg.content || '';
      return c.length > 42 ? c.slice(0,42) + '…' : c;
    },
    duration(s) {
      const m = Math.floor(s/60), sec = s%60;
      return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    },
  };

  return { Auth, Users, Contacts, Messages, Format, getToken, isLoggedIn };
})();

window.API = API;
