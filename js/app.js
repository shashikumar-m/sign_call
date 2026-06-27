/**
 * SignCall — Chat App (100% server-backed, zero localStorage data)
 * app.js
 */
(async function () {
  'use strict';

  // ── Auth guard — fetch real user from server ─────────────────
  if (!API.isLoggedIn()) { window.location.href = 'index.html'; return; }

  let currentUser;
  try {
    currentUser = await API.Auth.me();   // fresh from MongoDB
  } catch (err) {
    UI.Toast.error('Session error: ' + err.message);
    API.Auth.logout();
    return;
  }

  // ── Socket.io (real-time notifications) ─────────────────────
  const socket = io(window.location.origin, {
    auth: { token: API.getToken() },
    transports: ['websocket','polling'],
  });

  socket.on('connect', () => console.log('[socket] connected'));
  socket.on('connect_error', (e) => console.warn('[socket] error:', e.message));

  // Real-time new message notification
  socket.on('new_message', (msg) => {
    const cid = msg.from?._id || msg.from;
    if (state.activeContactId === cid) {
      appendMsgEl(msg);
      UI.scrollToBottom(messagesArea);
    } else {
      UI.Toast.info(`💬 ${msg.from?.name || 'Someone'}: ${API.Format.msgPreview(msg)}`);
    }
    refreshContactList();
  });

  // Typing indicator
  socket.on('typing', ({ fromUserId, fromName, isTyping }) => {
    if (fromUserId === state.activeContactId) {
      const typingEl = document.getElementById('typingIndicator');
      if (typingEl) typingEl.textContent = isTyping ? `${fromName} is typing…` : '';
    }
  });

  // Online presence updates
  socket.on('presence', ({ userId, isOnline, lastSeen }) => {
    // Update contact item in list
    const item = contactsList.querySelector(`[data-id="${userId}"]`);
    if (item) {
      const dot = item.querySelector('.contact-status');
      if (dot) {
        dot.className = `contact-status status-dot ${isOnline ? 'status-online' : 'status-offline'}`;
      }
    }
    // Update chat header if this is the active contact
    if (userId === state.activeContactId) {
      const sub = document.getElementById('chatHeaderSub');
      if (sub) sub.textContent = isOnline ? '● Online' : `Last seen ${API.Format.relativeTime(lastSeen)}`;
    }
  });

  // ── State ────────────────────────────────────────────────────
  const state = {
    activeContactId: null,
    contacts: [],
    signPanelOpen: false,
    signStream: null,
    handsInstance: null,
    cameraUtil: null,
    signWords: [],
    signRunning: false,
    typingTimer: null,
  };

  // ── DOM refs ─────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const contactsList  = $('contactsList');
  const messagesArea  = $('messagesArea');
  const chatHeader    = $('chatHeader');
  const inputBar      = $('inputBar');
  const welcomeScreen = $('welcomeScreen');
  const msgInput      = $('msgInput');
  const signPanel     = $('signPanel');
  const signWordQueue = $('signWordQueue');
  const signGestureLabel = $('signGestureLabel');
  const signConfFill  = $('signConfFill');
  const signConfPct   = $('signConfPct');
  const signVideo     = $('signVideo');
  const signCanvas    = $('signCanvas');
  const btnSend       = $('btnSend');
  const btnSendSign   = $('btnSendSign');
  const emojiPicker   = $('emojiPicker');

  // ── Init user avatar in rail ─────────────────────────────────
  const navAvatar = $('navAvatar');
  if (navAvatar) {
    navAvatar.textContent = API.Format.initials(currentUser.name);
    navAvatar.style.background = currentUser.avatarColor || 'var(--color-primary)';
  }

  // ── Load contacts on boot ─────────────────────────────────────
  loadContacts();

  async function loadContacts() {
    contactsList.innerHTML = UI.Skeleton.contacts(4);
    try {
      state.contacts = await API.Contacts.getAll();
      renderContactList();
    } catch (err) {
      UI.Toast.error('Could not load contacts: ' + err.message);
      contactsList.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p class="empty-desc">Could not load contacts</p></div>`;
    }
  }

  function renderContactList(filter = '') {
    const q = filter.toLowerCase();
    const filtered = state.contacts.filter(c =>
      !q || c.name.toLowerCase().includes(q) || (c.username && c.username.toLowerCase().includes(q))
    );

    if (!filtered.length) {
      contactsList.innerHTML = `<div class="empty-state">
        <div class="empty-icon">${filter ? '🔍' : '💬'}</div>
        <div class="empty-title">${filter ? 'No results' : 'No contacts yet'}</div>
        <p class="empty-desc">${filter ? 'Try a different search.' : 'Click + to add a contact.'}</p>
      </div>`;
      return;
    }

    contactsList.innerHTML = filtered.map(c => {
      const isActive = state.activeContactId === (c._id || c.id);
      const statusCls = c.isOnline ? 'status-online' : 'status-offline';
      return `<div class="contact-item${isActive?' active':''}" data-id="${c._id||c.id}" role="listitem" tabindex="0">
        <div class="contact-avatar-wrap">
          <div class="avatar avatar-md" style="background:${c.avatarColor||'var(--color-primary)'}">
            ${API.Format.initials(c.name)}
          </div>
          <span class="contact-status status-dot ${statusCls}" aria-label="${c.isOnline?'Online':'Offline'}"></span>
        </div>
        <div class="contact-info">
          <div class="contact-name">${escHtml(c.name)}</div>
          <div class="contact-last-msg text-faint">${c.isOnline ? '● Online' : API.Format.relativeTime(c.lastSeen)}</div>
        </div>
      </div>`;
    }).join('');

    contactsList.querySelectorAll('.contact-item').forEach(item => {
      const open = () => {
        const cid = item.dataset.id;
        const contact = state.contacts.find(c => (c._id||c.id) === cid);
        if (contact) openChatWith(contact);
      };
      item.addEventListener('click', open);
      item.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') open(); });
    });
  }

  async function refreshContactList() {
    try {
      state.contacts = await API.Contacts.getAll();
      renderContactList($('contactSearch').value || '');
    } catch {}
  }

  // ── Open chat ─────────────────────────────────────────────────
  async function openChatWith(contact) {
    const cid = contact._id || contact.id;
    state.activeContactId = cid;

    welcomeScreen.classList.add('hidden');
    chatHeader.classList.remove('hidden');
    messagesArea.classList.remove('hidden');
    inputBar.classList.remove('hidden');

    $('chatHeaderAvatar').textContent = API.Format.initials(contact.name);
    $('chatHeaderAvatar').style.background = contact.avatarColor || 'var(--color-primary)';
    $('chatHeaderName').textContent = contact.name;
    $('chatHeaderSub').textContent  = contact.isOnline ? '● Online' : `Last seen ${API.Format.relativeTime(contact.lastSeen)}`;

    $('btnVideoCall').onclick = () => window.location.href = `call.html?cid=${cid}&mode=video`;
    $('btnVoiceCall').onclick = () => window.location.href = `call.html?cid=${cid}&mode=voice`;

    renderContactList($('contactSearch').value || '');

    // Load messages from server
    messagesArea.innerHTML = `<div style="text-align:center;padding:20px;color:var(--color-text-3)">Loading…</div>`;
    try {
      const msgs = await API.Messages.getConversation(cid);
      renderMessages(msgs);
    } catch (err) {
      messagesArea.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><p>${escHtml(err.message)}</p></div>`;
    }
    msgInput.focus();
  }

  function renderMessages(msgs) {
    messagesArea.innerHTML = '';
    if (!msgs.length) {
      messagesArea.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div>
        <div class="empty-title">Start the conversation</div>
        <p class="empty-desc">Say hello or sign a greeting!</p></div>`;
      return;
    }
    let lastDate = null;
    msgs.forEach(msg => {
      const d = new Date(msg.timestamp).toDateString();
      if (d !== lastDate) {
        lastDate = d;
        const div = document.createElement('div');
        div.className = 'date-divider';
        div.innerHTML = `<span class="date-label">${d === new Date().toDateString() ? 'Today' : d}</span>`;
        messagesArea.appendChild(div);
      }
      appendMsgEl(msg);
    });
    UI.scrollToBottom(messagesArea, false);
    // Typing indicator placeholder
    const typing = document.createElement('div');
    typing.id = 'typingIndicator';
    typing.style.cssText = 'font-size:0.78rem;color:var(--color-text-3);padding:4px 20px;min-height:20px';
    messagesArea.appendChild(typing);
  }

  function appendMsgEl(msg) {
    const uid = currentUser._id || currentUser.id;
    const isMe = (msg.from?._id || msg.from) === uid || (msg.from?._id || msg.from)?.toString() === uid?.toString();
    const contact = state.contacts.find(c => (c._id||c.id) === state.activeContactId);

    const row = document.createElement('div');
    row.className = `msg-row ${isMe ? 'sent' : 'recv'}`;

    let bubble = '';
    if (msg.type === 'sign') {
      bubble = `<div class="msg-bubble msg-sign${isMe?' sent':''}">
        <div class="sign-label">✋ ${escHtml(msg.signLabel||'ASL Sign')}</div>
        ${escHtml(msg.content)}
      </div>`;
    } else {
      bubble = `<div class="msg-bubble">${escHtml(msg.content)}</div>`;
    }

    const avatarHtml = !isMe
      ? `<div class="avatar avatar-sm" style="background:${contact?.avatarColor||'var(--color-primary)'}">${API.Format.initials(contact?.name||'?')}</div>`
      : '';

    row.innerHTML = `${avatarHtml}<div>${bubble}
      <span class="msg-time">${API.Format.time(msg.timestamp)}${isMe?' ✓✓':''}</span>
    </div>`;
    messagesArea.appendChild(row);
  }

  // ── Send message ──────────────────────────────────────────────
  async function sendTextMessage() {
    const text = msgInput.value.trim();
    if (!text || !state.activeContactId) return;
    btnSend.disabled = true;
    msgInput.value = '';
    msgInput.style.height = 'auto';

    try {
      const msg = await API.Messages.send(state.activeContactId, text);
      appendMsgEl(msg);
      UI.scrollToBottom(messagesArea);
    } catch (err) {
      UI.Toast.error('Send failed: ' + err.message);
      msgInput.value = text; // restore
    }
    btnSend.disabled = false;
  }

  msgInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 140) + 'px';
    btnSend.disabled = !this.value.trim();
    // Typing indicator
    if (state.activeContactId) {
      socket.emit('typing', { toUserId: state.activeContactId, isTyping: true });
      clearTimeout(state.typingTimer);
      state.typingTimer = setTimeout(() => {
        socket.emit('typing', { toUserId: state.activeContactId, isTyping: false });
      }, 1500);
    }
  });
  msgInput.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } });
  btnSend.addEventListener('click', sendTextMessage);

  // ── Contact search ────────────────────────────────────────────
  $('contactSearch').addEventListener('input', UI.debounce(function() {
    renderContactList(this.value);
  }, 200));

  // ── Navigation tabs ───────────────────────────────────────────
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
      tab.classList.add('active'); tab.setAttribute('aria-selected','true');
    });
  });
  $('railLogout').addEventListener('click', () => { if (confirm('Sign out?')) API.Auth.logout(); });

  // ── Add contact modal ─────────────────────────────────────────
  const addContactModal = $('addContactModal');
  $('btnAddContact').addEventListener('click', () => UI.Modal.open(addContactModal));
  $('welcomeAddBtn').addEventListener('click', () => UI.Modal.open(addContactModal));
  $('addContactClose').addEventListener('click', () => UI.Modal.close(addContactModal));

  $('addContactSearch').addEventListener('input', UI.debounce(async function() {
    const q = this.value.trim();
    const results = $('addContactResults');
    if (q.length < 2) { results.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-desc">Type at least 2 characters</p></div>`; return; }
    results.innerHTML = `<div style="padding:12px;text-align:center;color:var(--color-text-3)">Searching…</div>`;
    try {
      const users = await API.Users.search(q);
      if (!users.length) { results.innerHTML = `<div class="empty-state"><div class="empty-icon">😕</div><p class="empty-desc">No users found</p></div>`; return; }
      const isContact = (id) => state.contacts.some(c => (c._id||c.id) === id);
      results.innerHTML = users.map(u => `
        <div class="search-result-item" data-uid="${u._id||u.id}">
          <div class="avatar avatar-md" style="background:${u.avatarColor||'var(--color-primary)'}">${API.Format.initials(u.name)}</div>
          <div style="flex:1">
            <div style="font-weight:600;font-size:0.9rem">${escHtml(u.name)}</div>
            <div style="font-size:0.78rem;color:var(--color-text-3)">@${escHtml(u.username)} · ${escHtml(u.userType)}</div>
          </div>
          ${isContact(u._id||u.id)
            ? '<span style="font-size:0.78rem;color:var(--color-accent)">✓ Added</span>'
            : `<button class="btn btn-primary btn-sm" data-add="${u._id||u.id}">Add</button>`}
        </div>`).join('');
      results.querySelectorAll('[data-add]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const uid = btn.dataset.add;
          btn.disabled = true; btn.textContent = 'Adding…';
          try {
            await API.Contacts.add(uid);
            btn.textContent = '✓ Added';
            UI.Toast.success('Contact added!');
            await loadContacts();
          } catch (err) {
            btn.disabled = false; btn.textContent = 'Add';
            UI.Toast.error(err.message);
          }
        });
      });
    } catch (err) { results.innerHTML = `<div class="empty-state"><p>${escHtml(err.message)}</p></div>`; }
  }, 350));

  // ── Profile modal ─────────────────────────────────────────────
  const profileModal = $('profileModal');
  $('railProfile').addEventListener('click', async () => {
    try {
      const u = await API.Auth.me();   // always fetch fresh from server
      $('profileName').value = u?.name || '';
      $('profileBio').value  = u?.bio  || '';
      $('profileAvatar').textContent = API.Format.initials(u?.name||'?');
      $('profileAvatar').style.background = u?.avatarColor || 'var(--color-primary)';
      UI.Modal.open(profileModal);
    } catch (err) { UI.Toast.error('Could not load profile: ' + err.message); }
  });
  $('profileClose').addEventListener('click', () => UI.Modal.close(profileModal));
  $('btnSaveProfile').addEventListener('click', async () => {
    try {
      const user = await API.Auth.updateProfile({ name: $('profileName').value.trim(), bio: $('profileBio').value.trim() });
      if ($('navAvatar')) $('navAvatar').textContent = API.Format.initials(user.name);
      UI.Toast.success('Profile updated ✓');
      UI.Modal.close(profileModal);
    } catch (err) { UI.Toast.error(err.message); }
  });

  // ── Sign language panel ───────────────────────────────────────
  $('btnSignToggle').addEventListener('click', () => {
    state.signPanelOpen = !state.signPanelOpen;
    signPanel.classList.toggle('open', state.signPanelOpen);
    $('btnSignToggle').setAttribute('aria-pressed', state.signPanelOpen);
    if (!state.signPanelOpen) stopSignCapture();
  });
  $('btnCloseSign').addEventListener('click', () => { state.signPanelOpen = false; signPanel.classList.remove('open'); stopSignCapture(); });
  $('btnStartSign').addEventListener('click', startSignCapture);
  $('btnStopSign') .addEventListener('click', stopSignCapture);
  $('btnClearSign').addEventListener('click', clearSignWords);

  $('btnSendSign').addEventListener('click', async () => {
    if (!state.signWords.length || !state.activeContactId) return;
    const content   = state.signWords.join(' ');
    const signLabel = 'ASL: ' + state.signWords.join(', ');
    try {
      const msg = await API.Messages.send(state.activeContactId, content, 'sign', signLabel);
      appendMsgEl(msg);
      UI.scrollToBottom(messagesArea);
      clearSignWords();
    } catch (err) { UI.Toast.error(err.message); }
  });

  async function startSignCapture() {
    $('btnStartSign').disabled = true; $('btnStopSign').disabled = false;
    signGestureLabel.textContent = 'Starting camera…';
    try {
      state.signStream = await navigator.mediaDevices.getUserMedia({ video: { width:{ideal:640}, height:{ideal:480}, facingMode:'user' } });
      signVideo.srcObject = state.signStream;
      await signVideo.play();
      signVideo.addEventListener('loadedmetadata', () => { signCanvas.width=signVideo.videoWidth; signCanvas.height=signVideo.videoHeight; }, { once:true });
      state.signRunning = true;
      signGestureLabel.textContent = 'Show your hand…';
      startSignHandsDetection();
    } catch (err) {
      UI.Toast.error('Camera denied: ' + err.message);
      $('btnStartSign').disabled = false; $('btnStopSign').disabled = true;
      signGestureLabel.textContent = 'Camera access denied';
    }
  }

  function stopSignCapture() {
    state.signRunning = false;
    if (state.handsInstance) { try { state.handsInstance.close(); } catch {} state.handsInstance = null; }
    if (state.cameraUtil)    { try { state.cameraUtil.stop(); }     catch {} state.cameraUtil = null; }
    if (state.signStream)    { state.signStream.getTracks().forEach(t=>t.stop()); state.signStream = null; }
    signVideo.srcObject = null;
    const ctx = signCanvas.getContext('2d');
    if (ctx) ctx.clearRect(0,0,signCanvas.width,signCanvas.height);
    signGestureLabel.textContent = 'Point camera at your hand';
    signConfFill.style.width = '0%'; signConfPct.textContent = '0%';
    $('btnStartSign').disabled = false; $('btnStopSign').disabled = true;
  }

  function startSignHandsDetection() {
    if (typeof Hands === 'undefined') { UI.Toast.error('MediaPipe not loaded. Check internet.'); return; }
    state.handsInstance = new Hands({ locateFile: f=>`https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
    state.handsInstance.setOptions({ maxNumHands:1, modelComplexity:1, minDetectionConfidence:0.65, minTrackingConfidence:0.5 });
    state.handsInstance.onResults(onSignResults);
    state.cameraUtil = new Camera(signVideo, { onFrame: async () => { if (!state.signRunning) return; await state.handsInstance.send({ image: signVideo }); }, width:640, height:480 });
    state.cameraUtil.start();
  }

  function onSignResults(results) {
    const ctx = signCanvas.getContext('2d');
    GestureEngine.clearCanvas(ctx, signCanvas.width, signCanvas.height);
    if (!results.multiHandLandmarks?.length) { signGestureLabel.textContent = 'No hand detected'; signConfFill.style.width='0%'; signConfPct.textContent='0%'; return; }
    const lm = results.multiHandLandmarks[0];
    GestureEngine.drawHandOnCanvas(ctx, lm, signCanvas.width, signCanvas.height, true);
    const result = GestureEngine.processFrame(lm);
    if (!result) return;
    const pct = Math.round(result.confidence * 100);
    signGestureLabel.textContent = result.name === '…' ? 'Detecting…' : `✋ ${result.name}`;
    signConfFill.style.width = pct + '%'; signConfPct.textContent = pct + '%';
    if (result.emit && result.name && result.name !== '…') {
      addSignWord(result.name);
      SpeechEngine.speak(result.name, { lang:'en-US' });
    }
  }

  function addSignWord(word) {
    state.signWords.push(word);
    renderSignQueue();
    $('btnSendSign').disabled = false;
  }

  function clearSignWords() {
    state.signWords = [];
    renderSignQueue();
    $('btnSendSign').disabled = true;
  }

  function renderSignQueue() {
    if (!state.signWords.length) {
      signWordQueue.innerHTML = '<span style="color:var(--color-text-3);font-size:0.82rem">Detected words appear here…</span>';
      return;
    }
    signWordQueue.innerHTML = state.signWords.map((w,i) =>
      `<span class="sign-word" data-idx="${i}" role="button" tabindex="0">${escHtml(w)} ×</span>`).join('');
    signWordQueue.querySelectorAll('.sign-word').forEach(el => {
      el.addEventListener('click', () => { state.signWords.splice(+el.dataset.idx,1); renderSignQueue(); $('btnSendSign').disabled = !state.signWords.length; });
    });
  }

  // ── Emoji picker ──────────────────────────────────────────────
  let emojiLoaded = {};
  function buildEmojiTabs() {
    const tabs = $('emojiTabs'); tabs.innerHTML = '';
    UI.Emoji.categories.forEach((cat,i) => {
      const btn = document.createElement('button');
      btn.className = `emoji-tab${i===0?' active':''}`;
      btn.textContent = cat.icon; btn.title = cat.name;
      btn.addEventListener('click', () => { tabs.querySelectorAll('.emoji-tab').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); loadEmojiCat(cat.name); });
      tabs.appendChild(btn);
    });
    loadEmojiCat(UI.Emoji.categories[0].name);
  }
  function loadEmojiCat(name) {
    if (!emojiLoaded[name]) emojiLoaded[name] = UI.Emoji.getCategoryEmojis(name);
    renderEmojiGrid(emojiLoaded[name]);
  }
  function renderEmojiGrid(emojis) {
    const grid = $('emojiGrid');
    grid.innerHTML = emojis.slice(0,80).map(e=>`<button class="emoji-btn" aria-label="${e}">${e}</button>`).join('');
    grid.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s=msgInput.selectionStart, end=msgInput.selectionEnd;
        msgInput.value = msgInput.value.slice(0,s) + btn.textContent + msgInput.value.slice(end);
        msgInput.selectionStart = msgInput.selectionEnd = s + btn.textContent.length;
        btnSend.disabled = !msgInput.value.trim();
        emojiPicker.classList.remove('open');
        msgInput.focus();
      });
    });
  }
  $('btnEmojiToggle').addEventListener('click', () => {
    const open = emojiPicker.classList.toggle('open');
    $('btnEmojiToggle').setAttribute('aria-expanded', open);
    if (open && !$('emojiTabs').children.length) buildEmojiTabs();
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#emojiPicker') && !e.target.closest('#btnEmojiToggle')) emojiPicker.classList.remove('open');
  });
  $('btnAttach').addEventListener('click', () => UI.Toast.info('File sharing coming soon 📎'));

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Auto-refresh contacts every 30s
  setInterval(refreshContactList, 30000);

})();