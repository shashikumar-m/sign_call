/**
 * SignConnect — Chat Application Logic
 * app.js
 */
(function () {
  'use strict';

  // ── Require auth ──────────────────────────────────────────
  const currentUser = Auth.requireAuth();
  if (!currentUser) return;
  DB.Presence.set(currentUser.id, 'online');

  // ── State ─────────────────────────────────────────────────
  const state = {
    activeContact:  null,
    activePanel:    'chats',  // 'chats' | 'contacts' | 'settings'
    signPanelOpen:  false,
    signStream:     null,
    handsInstance:  null,
    cameraUtil:     null,
    signWords:      [],
    signRunning:    false,
  };

  // ── DOM refs ──────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const contactsList    = $('contactsList');
  const messagesArea    = $('messagesArea');
  const chatHeader      = $('chatHeader');
  const inputBar        = $('inputBar');
  const welcomeScreen   = $('welcomeScreen');
  const msgInput        = $('msgInput');
  const signPanel       = $('signPanel');
  const signWordQueue   = $('signWordQueue');
  const signGestureLabel= $('signGestureLabel');
  const signConfFill    = $('signConfFill');
  const signConfPct     = $('signConfPct');
  const signVideo       = $('signVideo');
  const signCanvas      = $('signCanvas');
  const btnSend         = $('btnSend');
  const btnSendSign     = $('btnSendSign');
  const emojiPicker     = $('emojiPicker');
  const emojiGrid       = $('emojiGrid');
  const emojiTabs       = $('emojiTabs');

  // ── Init UI ───────────────────────────────────────────────
  const navAvatar = $('navAvatar');
  navAvatar.textContent = UI.Format.initials(currentUser.name);
  navAvatar.style.background = currentUser.avatarColor || 'var(--color-primary)';

  renderContactList();

  // ── Rail navigation ────────────────────────────────────────
  document.querySelectorAll('.rail-btn[data-rail]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rail-btn[data-rail]').forEach(b => {
        b.classList.remove('active');
        b.removeAttribute('aria-current');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-current', 'page');
      state.activePanel = btn.dataset.rail;
      $('sidebarPanelTitle').textContent =
        state.activePanel === 'chats' ? 'Chats' :
        state.activePanel === 'contacts' ? 'Contacts' : 'Settings';
      renderContactList();
    });
  });

  $('railLogout').addEventListener('click', () => {
    if (confirm('Sign out of SignConnect?')) Auth.logout();
  });

  // ── Sidebar tabs ────────────────────────────────────────────
  document.querySelectorAll('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      state.activePanel = tab.dataset.panel;
      $('sidebarPanelTitle').textContent = state.activePanel === 'chats' ? 'Chats' : 'Contacts';
      renderContactList();
    });
  });

  // ── Contact search ──────────────────────────────────────────
  const contactSearch = $('contactSearch');
  contactSearch.addEventListener('input', UI.debounce(() => renderContactList(contactSearch.value), 200));

  // ── Render contact list ─────────────────────────────────────
  function renderContactList(filter = '') {
    const contacts = DB.Contacts.getForUser(currentUser.id);
    const q = filter.toLowerCase();
    const filtered = contacts.filter(c =>
      !q || c.name.toLowerCase().includes(q) || (c.email && c.email.toLowerCase().includes(q))
    );

    if (filtered.length === 0) {
      contactsList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" aria-hidden="true">${filter ? '🔍' : '💬'}</div>
          <div class="empty-title">${filter ? 'No results' : 'No contacts yet'}</div>
          <p class="empty-desc">${filter ? 'Try a different search.' : 'Add contacts to start chatting.'}</p>
        </div>`;
      return;
    }

    let html = '';
    filtered.forEach(contact => {
      const last    = DB.Messages.lastMessage(currentUser.id, contact.id);
      const unread  = DB.Messages.unreadCount(currentUser.id, contact.id);
      const presence= DB.Presence.get(contact.id);
      const statusCls = presence.status === 'online' ? 'status-online' : 'status-offline';
      const isActive  = state.activeContact?.id === contact.id;

      html += `<div class="contact-item${isActive?' active':''}" role="listitem"
          data-id="${contact.id}" tabindex="0" aria-label="Chat with ${contact.name}">
        <div class="contact-avatar-wrap">
          <div class="avatar avatar-md" style="background:${contact.avatarColor||'var(--color-primary)'}">
            ${UI.Format.initials(contact.name)}
          </div>
          <span class="contact-status status-dot ${statusCls}" aria-label="${presence.status}"></span>
        </div>
        <div class="contact-info">
          <div class="contact-name">${escHtml(contact.name)}</div>
          <div class="contact-last-msg">${last ? escHtml(UI.Format.msgPreview(last)) : '<em>Start a conversation</em>'}</div>
        </div>
        <div class="contact-meta">
          <span class="contact-time">${last ? UI.Format.relativeTime(last.timestamp) : ''}</span>
          ${unread > 0 ? `<span class="badge badge-primary" aria-label="${unread} unread">${unread}</span>` : ''}
        </div>
      </div>`;
    });

    contactsList.innerHTML = html;

    contactsList.querySelectorAll('.contact-item').forEach(item => {
      const openChat = () => {
        const cid = item.dataset.id;
        const contact = contacts.find(c => c.id === cid);
        if (contact) openChatWith(contact);
      };
      item.addEventListener('click', openChat);
      item.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') openChat(); });
    });
  }

  // ── Open chat ────────────────────────────────────────────────
  function openChatWith(contact) {
    state.activeContact = contact;
    DB.Messages.markRead(currentUser.id, contact.id, currentUser.id);

    // Show/hide panels
    welcomeScreen.classList.add('hidden');
    chatHeader.classList.remove('hidden');
    messagesArea.classList.remove('hidden');
    inputBar.classList.remove('hidden');

    // Update header
    const presence = DB.Presence.get(contact.id);
    $('chatHeaderAvatar').textContent = UI.Format.initials(contact.name);
    $('chatHeaderAvatar').style.background = contact.avatarColor || 'var(--color-primary)';
    $('chatHeaderName').textContent = contact.name;
    $('chatHeaderSub').textContent  = presence.status === 'online' ? '● Online' : `Last seen ${UI.Format.relativeTime(presence.lastSeen)}`;
    $('chatHeaderStatus').className = `contact-status status-dot ${presence.status==='online'?'status-online':'status-offline'}`;

    // Video/voice call buttons open call.html
    $('btnVideoCall').onclick = () => openCall(contact, 'video');
    $('btnVoiceCall').onclick = () => openCall(contact, 'voice');

    renderMessages();
    renderContactList(contactSearch.value);
    msgInput.focus();
  }

  function openCall(contact, mode) {
    const params = new URLSearchParams({ cid: contact.id, mode });
    window.location.href = `call.html?${params.toString()}`;
  }

  // ── Render messages ──────────────────────────────────────────
  function renderMessages() {
    if (!state.activeContact) return;
    const msgs = DB.Messages.getConversation(currentUser.id, state.activeContact.id);
    messagesArea.innerHTML = '';

    if (msgs.length === 0) {
      messagesArea.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon" aria-hidden="true">💬</div>
          <div class="empty-title">Start the conversation</div>
          <p class="empty-desc">Say hello or sign a greeting to ${escHtml(state.activeContact.name)}!</p>
        </div>`;
      return;
    }

    let lastDate = null;
    msgs.forEach((msg, idx) => {
      // Date divider
      const msgDate = UI.Format.date(msg.timestamp);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const div = document.createElement('div');
        div.className = 'date-divider';
        div.innerHTML = `<span class="date-label">${msgDate}</span>`;
        messagesArea.appendChild(div);
      }
      appendMsgEl(msg, false);
    });

    UI.scrollToBottom(messagesArea, false);
  }

  function appendMsgEl(msg, scroll = true) {
    const isMe = msg.from === currentUser.id;
    const isSameAsPrev = () => {
      const children = messagesArea.querySelectorAll('.msg-row');
      if (!children.length) return false;
      const last = children[children.length-1];
      return last.dataset.from === msg.from;
    };

    const row = document.createElement('div');
    row.className = `msg-row ${isMe ? 'sent' : 'recv'}`;
    row.dataset.msgId = msg.id;
    row.dataset.from  = msg.from;

    let bubbleHtml = '';
    if (msg.type === 'sign') {
      bubbleHtml = `<div class="msg-bubble msg-sign ${isMe?'sent':''}">
        <div class="sign-label"><span aria-hidden="true">✋</span>${escHtml(msg.signLabel||'ASL Sign')}</div>
        ${escHtml(msg.content)}
      </div>`;
    } else {
      bubbleHtml = `<div class="msg-bubble">${escHtml(msg.content)}</div>`;
    }

    const avatar = !isMe && !isSameAsPrev()
      ? `<div class="avatar avatar-sm" style="background:${state.activeContact?.avatarColor||'var(--color-primary)'}">${UI.Format.initials(state.activeContact?.name||'?')}</div>`
      : (isMe ? '' : '<div style="width:32px;flex-shrink:0"></div>');

    row.innerHTML = `
      ${!isMe ? avatar : ''}
      <div>
        ${bubbleHtml}
        <span class="msg-time">${UI.Format.time(msg.timestamp)}${isMe?' ✓✓':''}</span>
      </div>
      ${isMe ? '' : ''}
    `;

    messagesArea.appendChild(row);
    if (scroll) UI.scrollToBottom(messagesArea);
  }

  // ── Send text message ────────────────────────────────────────
  function sendTextMessage() {
    const text = msgInput.value.trim();
    if (!text || !state.activeContact) return;

    const msg = DB.Messages.send(currentUser.id, state.activeContact.id, text, 'text');
    appendMsgEl(msg);
    msgInput.value = '';
    msgInput.style.height = 'auto';
    btnSend.disabled = true;
    renderContactList(contactSearch.value);

    // Simulate reply from contact (for demo/testing purposes)
    simulateReply();
  }

  function simulateReply() {
    if (!state.activeContact) return;
    const contact = state.activeContact;
    const delay = 1200 + Math.random() * 1200;

    setTimeout(() => {
      if (!state.activeContact || state.activeContact.id !== contact.id) return;
      const isSign = contact.userType === 'mute' || contact.userType === 'deafmute';
      const replies = ['Got it! 👍', 'That makes sense.', 'Thanks for sharing!', 'Sounds good!', 'I understand.', 'OK, see you then!'];
      const signReplies = ['Hello', 'Thank You', 'I Love You', 'Good', 'Yes', 'Peace'];
      const content = isSign
        ? signReplies[Math.floor(Math.random() * signReplies.length)]
        : replies[Math.floor(Math.random() * replies.length)];

      const msg = DB.Messages.send(contact.id, currentUser.id, content, isSign ? 'sign' : 'text');
      if (isSign) msg.signLabel = 'ASL: ' + content;
      appendMsgEl(msg);
      renderContactList(contactSearch.value);
    }, delay);
  }

  // ── Input handlers ───────────────────────────────────────────
  msgInput.addEventListener('input', function () {
    // Auto-resize
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 140) + 'px';
    btnSend.disabled = !this.value.trim();
  });

  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); }
  });

  btnSend.addEventListener('click', sendTextMessage);

  $('btnAttach').addEventListener('click', () => {
    UI.Toast.info('File sharing — coming in the next release 📎');
  });

  // ── Add contact modal ────────────────────────────────────────
  const addContactModal = $('addContactModal');
  $('btnAddContact')  .addEventListener('click', () => UI.Modal.open(addContactModal));
  $('welcomeAddBtn')  .addEventListener('click', () => UI.Modal.open(addContactModal));
  $('addContactClose').addEventListener('click', () => UI.Modal.close(addContactModal));

  const addContactSearch  = $('addContactSearch');
  const addContactResults = $('addContactResults');

  addContactSearch.addEventListener('input', UI.debounce(() => {
    const q = addContactSearch.value.trim();
    if (!q) {
      addContactResults.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-desc">Start typing to search</p></div>`;
      return;
    }
    const users = DB.Users.search(q).filter(u => u.id !== currentUser.id);
    if (!users.length) {
      addContactResults.innerHTML = `<div class="empty-state"><div class="empty-icon">😕</div><p class="empty-desc">No users found for "${escHtml(q)}"</p></div>`;
      return;
    }
    addContactResults.innerHTML = users.map(u => `
      <div class="search-result-item" data-uid="${u.id}" role="listitem" tabindex="0">
        <div class="avatar avatar-md" style="background:${u.avatarColor||'var(--color-primary)'}">${UI.Format.initials(u.name)}</div>
        <div>
          <div style="font-size:0.9rem;font-weight:600">${escHtml(u.name)}</div>
          <div style="font-size:0.78rem;color:var(--color-text-3)">${escHtml(u.email)}</div>
        </div>
        ${DB.Contacts.isContact(currentUser.id, u.id)
          ? '<span style="font-size:0.78rem;color:var(--color-accent)">✓ Added</span>'
          : '<button class="btn btn-primary btn-sm">Add</button>'}
      </div>`).join('');

    addContactResults.querySelectorAll('.search-result-item').forEach(item => {
      const addBtn = item.querySelector('button');
      if (!addBtn) return;
      addBtn.addEventListener('click', () => {
        const uid = item.dataset.uid;
        DB.Contacts.add(currentUser.id, uid);
        UI.Toast.success('Contact added!');
        addBtn.textContent = '✓ Added';
        addBtn.disabled = true;
        renderContactList();
      });
    });
  }, 250));

  // ── Profile modal ────────────────────────────────────────────
  const profileModal = $('profileModal');
  $('railProfile').addEventListener('click', () => {
    const fresh = Auth.refreshSession();
    $('profileName').value = fresh?.name || '';
    $('profileBio').value  = fresh?.bio  || '';
    $('profileAvatar').textContent = UI.Format.initials(fresh?.name || '?');
    $('profileAvatar').style.background = fresh?.avatarColor || 'var(--color-primary)';
    UI.Modal.open(profileModal);
  });
  $('profileClose').addEventListener('click', () => UI.Modal.close(profileModal));

  $('btnSaveProfile').addEventListener('click', () => {
    const name = $('profileName').value.trim();
    const bio  = $('profileBio').value.trim();
    if (!name) { UI.Toast.error('Name cannot be empty'); return; }
    Auth.updateProfile({ name, bio });
    navAvatar.textContent = UI.Format.initials(name);
    UI.Toast.success('Profile updated ✓');
    UI.Modal.close(profileModal);
    renderContactList();
  });

  // ── Emoji picker ──────────────────────────────────────────────
  let emojiCatLoaded = {};

  function buildEmojiTabs() {
    emojiTabs.innerHTML = '';
    UI.Emoji.categories.forEach((cat, i) => {
      const btn = document.createElement('button');
      btn.className = `emoji-tab${i===0?' active':''}`;
      btn.textContent = cat.icon;
      btn.title = cat.name;
      btn.setAttribute('role','tab');
      btn.setAttribute('aria-label', cat.name);
      btn.addEventListener('click', () => {
        emojiTabs.querySelectorAll('.emoji-tab').forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        loadEmojiCategory(cat.name);
      });
      emojiTabs.appendChild(btn);
    });
    loadEmojiCategory(UI.Emoji.categories[0].name);
  }

  function loadEmojiCategory(catName) {
    if (emojiCatLoaded[catName]) {
      emojiGrid.dataset.cat = catName;
      filterEmoji('');
      return;
    }
    const emojis = UI.Emoji.getCategoryEmojis(catName);
    emojiCatLoaded[catName] = emojis;
    emojiGrid.dataset.cat = catName;
    renderEmojiGrid(emojis);
  }

  function renderEmojiGrid(emojis) {
    emojiGrid.innerHTML = emojis.map(e =>
      `<button class="emoji-btn" data-emoji="${e}" title="${e}" aria-label="Insert ${e}">${e}</button>`
    ).join('');
    emojiGrid.querySelectorAll('.emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        insertAtCursor(msgInput, btn.dataset.emoji);
        btnSend.disabled = !msgInput.value.trim();
        emojiPicker.classList.remove('open');
        $('btnEmojiToggle').setAttribute('aria-expanded','false');
        msgInput.focus();
      });
    });
  }

  function filterEmoji(query) {
    const cat = emojiGrid.dataset.cat;
    const emojis = emojiCatLoaded[cat] || [];
    renderEmojiGrid(query ? emojis.filter(e => e.includes(query)) : emojis);
  }

  $('btnEmojiToggle').addEventListener('click', () => {
    const isOpen = emojiPicker.classList.toggle('open');
    $('btnEmojiToggle').setAttribute('aria-expanded', isOpen);
    if (isOpen && !emojiTabs.children.length) buildEmojiTabs();
  });

  $('emojiSearch').addEventListener('input', UI.debounce(function() {
    filterEmoji(this.value);
  }, 200));

  document.addEventListener('click', e => {
    if (!e.target.closest('#emojiPicker') && !e.target.closest('#btnEmojiToggle')) {
      emojiPicker.classList.remove('open');
      $('btnEmojiToggle').setAttribute('aria-expanded','false');
    }
  });

  function insertAtCursor(el, text) {
    const s = el.selectionStart, end = el.selectionEnd;
    el.value = el.value.slice(0, s) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = s + text.length;
    el.dispatchEvent(new Event('input'));
  }

  // ── Sign language panel ───────────────────────────────────────
  $('btnSignToggle').addEventListener('click', () => {
    state.signPanelOpen = !state.signPanelOpen;
    signPanel.classList.toggle('open', state.signPanelOpen);
    $('btnSignToggle').setAttribute('aria-pressed', state.signPanelOpen);
    if (!state.signPanelOpen) stopSignCapture();
  });

  $('btnCloseSign').addEventListener('click', () => {
    state.signPanelOpen = false;
    signPanel.classList.remove('open');
    $('btnSignToggle').setAttribute('aria-pressed','false');
    stopSignCapture();
  });

  $('btnStartSign').addEventListener('click', startSignCapture);
  $('btnStopSign') .addEventListener('click', stopSignCapture);
  $('btnClearSign').addEventListener('click', clearSignWords);

  $('btnSendSign').addEventListener('click', () => {
    if (!state.signWords.length || !state.activeContact) return;
    const content   = state.signWords.join(' ');
    const signLabel = 'ASL Signs: ' + state.signWords.join(', ');
    const msg = DB.Messages.send(currentUser.id, state.activeContact.id, content, 'sign');
    msg.signLabel = signLabel;
    appendMsgEl(msg);
    clearSignWords();
    renderContactList(contactSearch.value);
    simulateReply();
  });

  async function startSignCapture() {
    $('btnStartSign').disabled = true;
    $('btnStopSign').disabled  = false;
    signGestureLabel.textContent = 'Starting camera…';

    try {
      state.signStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
      });
      signVideo.srcObject = state.signStream;
      await signVideo.play();

      // Resize canvas to match video
      signVideo.addEventListener('loadedmetadata', () => {
        signCanvas.width  = signVideo.videoWidth;
        signCanvas.height = signVideo.videoHeight;
      }, { once: true });

      state.signRunning = true;
      signGestureLabel.textContent = 'Show your hand…';
      startHandsDetection();
      UI.Toast.success('Camera started — sign away! 🤟');
    } catch (err) {
      UI.Toast.error('Camera access denied: ' + err.message);
      $('btnStartSign').disabled = false;
      $('btnStopSign').disabled  = true;
      signGestureLabel.textContent = 'Camera access denied';
    }
  }

  function stopSignCapture() {
    state.signRunning = false;
    if (state.handsInstance) { try { state.handsInstance.close(); } catch {} state.handsInstance = null; }
    if (state.cameraUtil)    { try { state.cameraUtil.stop(); }     catch {} state.cameraUtil = null; }
    if (state.signStream)    {
      state.signStream.getTracks().forEach(t => t.stop());
      state.signStream = null;
    }
    signVideo.srcObject = null;
    const ctx = signCanvas.getContext('2d');
    ctx && ctx.clearRect(0, 0, signCanvas.width, signCanvas.height);
    signGestureLabel.textContent = 'Point camera at your hand';
    setConfidence(0);
    $('btnStartSign').disabled = false;
    $('btnStopSign').disabled  = true;
  }

  function startHandsDetection() {
    if (typeof Hands === 'undefined') {
      UI.Toast.error('MediaPipe not loaded. Check internet connection.');
      return;
    }

    state.handsInstance = new Hands({
      locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    state.handsInstance.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.65,
      minTrackingConfidence: 0.5,
    });

    state.handsInstance.onResults(onSignResults);

    state.cameraUtil = new Camera(signVideo, {
      onFrame: async () => {
        if (!state.signRunning) return;
        await state.handsInstance.send({ image: signVideo });
      },
      width: 640,
      height: 480,
    });
    state.cameraUtil.start();
  }

  function onSignResults(results) {
    const ctx = signCanvas.getContext('2d');
    GestureEngine.clearCanvas(ctx, signCanvas.width, signCanvas.height);

    if (!results.multiHandLandmarks || !results.multiHandLandmarks.length) {
      signGestureLabel.textContent = 'No hand detected — move closer';
      setConfidence(0);
      return;
    }

    const landmarks = results.multiHandLandmarks[0];
    GestureEngine.drawHandOnCanvas(ctx, landmarks, signCanvas.width, signCanvas.height, true);

    const result = GestureEngine.processFrame(landmarks);
    if (!result) return;

    signGestureLabel.textContent = result.name === '…'
      ? 'Detecting…'
      : `✋ ${result.name}`;
    setConfidence(result.confidence);

    if (result.emit && result.name && result.name !== '…') {
      addSignWord(result.name);
      // TTS: speak the detected sign
      SpeechEngine.speak(result.name, { lang: 'en-US' });
    }
  }

  function setConfidence(val) {
    const pct = Math.round(val * 100);
    signConfFill.style.width = pct + '%';
    signConfPct.textContent  = pct + '%';
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
    signWordQueue.innerHTML = state.signWords.map((w, i) =>
      `<span class="sign-word" data-idx="${i}" role="button" tabindex="0" title="Remove" aria-label="Remove ${w}">${escHtml(w)} ×</span>`
    ).join('');
    signWordQueue.querySelectorAll('.sign-word').forEach(el => {
      el.addEventListener('click', () => {
        state.signWords.splice(+el.dataset.idx, 1);
        renderSignQueue();
        $('btnSendSign').disabled = state.signWords.length === 0;
      });
    });
  }

  // ── Utility ─────────────────────────────────────────────────
  function escHtml(str) {
    return String(str||'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Auto-refresh contact list every 30s
  setInterval(() => renderContactList(contactSearch.value), 30000);

  // Mark offline on close
  window.addEventListener('beforeunload', () => DB.Presence.setOffline(currentUser.id));

})();
