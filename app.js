/* ===================================================
   SignConnect — Main Application Logic
   ===================================================*/

// ── State ──────────────────────────────────────────
const state = {
  currentUser: null,
  currentContact: null,
  messages: {},          // keyed by contactId
  callActive: false,
  micOn: true,
  camOn: true,
  captionsOn: true,
  signDetectOn: true,
  signWords: [],
  speechRecognition: null,
  speechRunning: false,
  callTimer: null,
  callSeconds: 0,
  localStream: null,
  signStream: null,
  signDetectionInterval: null,
};

// ── Demo Contacts ───────────────────────────────────
const CONTACTS = [
  { id: 'c1', name: 'Priya Sharma', avatar: '👩', status: 'online', type: 'mute', lastMsg: '🤟 "Thank you!"', time: '2m' },
  { id: 'c2', name: 'Alex Johnson', avatar: '🧑', status: 'online', type: 'deaf', lastMsg: 'See you tomorrow!', time: '15m' },
  { id: 'c3', name: 'Maria Garcia', avatar: '👩‍🦱', status: 'offline', type: 'hearing', lastMsg: 'How are you?', time: '1h' },
  { id: 'c4', name: 'Sam Lee', avatar: '🧒', status: 'online', type: 'deafmute', lastMsg: '🤟 "Good morning"', time: '3h' },
  { id: 'c5', name: 'Jordan Kim', avatar: '🧔', status: 'offline', type: 'hearing', lastMsg: 'Great talking!', time: '1d' },
];

// Pre-seeded demo messages
const DEMO_MESSAGES = {
  c1: [
    { id: 'm1', from: 'c1', text: 'Hello! 👋', time: '10:30', type: 'text' },
    { id: 'm2', from: 'me', text: 'Hi Priya! How are you?', time: '10:31', type: 'text' },
    { id: 'm3', from: 'c1', text: 'Thank you', time: '10:32', type: 'sign', signLabel: 'ASL: Thank You' },
    { id: 'm4', from: 'me', text: 'You\'re welcome! 😊', time: '10:33', type: 'text' },
  ],
  c2: [
    { id: 'm1', from: 'me', text: 'Hey Alex!', time: '09:00', type: 'text' },
    { id: 'm2', from: 'c2', text: 'See you tomorrow!', time: '09:05', type: 'text' },
  ],
  c3: [], c4: [], c5: []
};

// ── Sign Language Dictionary (Simulated) ────────────
const SIGN_PHRASES = [
  'Hello', 'Thank You', 'Good Morning', 'How Are You',
  'Nice to Meet You', 'I Love You', 'Please', 'Sorry',
  'Yes', 'No', 'Help', 'Water', 'Food', 'Home',
  'Family', 'Friend', 'Work', 'School', 'Hospital',
  'Good', 'Bad', 'Happy', 'Sad', 'Hungry', 'Tired'
];

// ── Page Navigation ─────────────────────────────────
function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

function scrollToSection(id) {
  document.getElementById(id).scrollIntoView({ behavior: 'smooth' });
}

// ── Auth ─────────────────────────────────────────────
function switchAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  document.getElementById(tab + '-form').classList.add('active');
  document.querySelectorAll('.auth-tab').forEach(t => {
    if ((tab === 'login' && t.textContent.trim() === 'Sign In') ||
        (tab === 'signup' && t.textContent.trim() === 'Create Account')) {
      t.classList.add('active');
    }
  });
}

function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  if (!email || !pass) { showToast('Please fill in all fields', 'error'); return; }
  state.currentUser = { name: email.split('@')[0] || 'User', avatar: '🧑', type: 'hearing' };
  enterApp();
}

function doSignup() {
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const pass = document.getElementById('signup-pass').value.trim();
  const type = document.getElementById('signup-type').value;
  if (!name || !email || !pass) { showToast('Please fill in all fields', 'error'); return; }
  state.currentUser = { name, avatar: '🧑', type };
  enterApp();
}

function guestLogin() {
  state.currentUser = { name: 'Guest User', avatar: '🧑', type: 'hearing' };
  enterApp();
}

function enterApp() {
  document.getElementById('sidebar-username').textContent = state.currentUser.name;
  document.getElementById('user-avatar').textContent = state.currentUser.avatar;
  // init messages store
  CONTACTS.forEach(c => { if (!state.messages[c.id]) state.messages[c.id] = [...(DEMO_MESSAGES[c.id] || [])]; });
  renderContactList('chats');
  renderContactList('contacts');
  showPage('app-page');
  showToast('Welcome, ' + state.currentUser.name + '! 🤟', 'success');
}

// ── Contact List Rendering ────────────────────────────
function renderContactList(type, filter = '') {
  const listEl = document.getElementById(type + '-list');
  if (!listEl) return;
  listEl.innerHTML = '';
  const filtered = CONTACTS.filter(c =>
    c.name.toLowerCase().includes(filter.toLowerCase())
  );
  filtered.forEach(contact => {
    const msgs = state.messages[contact.id] || [];
    const last = msgs.length ? msgs[msgs.length - 1] : null;
    const lastText = last ? (last.type === 'sign' ? '🤟 "' + last.text + '"' : last.text) : contact.lastMsg;
    const unread = msgs.filter(m => m.from !== 'me' && !m.read).length;

    const item = document.createElement('div');
    item.className = 'contact-item' + (state.currentContact?.id === contact.id ? ' active' : '');
    item.onclick = () => openChat(contact);
    item.innerHTML = `
      <div class="ci-avatar">
        ${contact.avatar}
        <div class="ci-badge ${contact.status}"></div>
      </div>
      <div class="ci-info">
        <div class="ci-top">
          <span class="ci-name">${contact.name}</span>
          <span class="ci-time">${last ? last.time : contact.time}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="ci-last">${lastText}</span>
          ${unread > 0 ? `<span class="ci-unread">${unread}</span>` : ''}
        </div>
      </div>
    `;
    listEl.appendChild(item);
  });
}

function filterContacts(value) {
  const activeTab = document.querySelector('.s-tab.active').textContent.trim().toLowerCase().includes('chat') ? 'chats' : 'contacts';
  renderContactList(activeTab, value);
}

function switchSideTab(tab, btn) {
  document.querySelectorAll('.s-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('chats-list').classList.toggle('hidden', tab !== 'chats');
  document.getElementById('contacts-list').classList.toggle('hidden', tab !== 'contacts');
}

// ── Open Chat ─────────────────────────────────────────
function openChat(contact) {
  state.currentContact = contact;
  // Mark messages read
  if (state.messages[contact.id]) {
    state.messages[contact.id].forEach(m => m.read = true);
  }
  document.getElementById('welcome-screen').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  document.getElementById('call-view').classList.add('hidden');

  document.getElementById('chat-avatar').textContent = contact.avatar;
  document.getElementById('chat-name').textContent = contact.name;
  document.getElementById('chat-status').textContent = contact.status === 'online' ? '● Online' : '○ Offline';
  document.getElementById('chat-status').style.color = contact.status === 'online' ? 'var(--success)' : 'var(--text3)';

  renderMessages(contact.id);
  renderContactList('chats');
  renderContactList('contacts');
}

// ── Message Rendering ─────────────────────────────────
function renderMessages(contactId) {
  const area = document.getElementById('messages-area');
  area.innerHTML = '';
  const msgs = state.messages[contactId] || [];

  if (msgs.length === 0) {
    area.innerHTML = `<div class="date-divider"><span>Start the conversation</span></div>`;
    return;
  }

  area.innerHTML = `<div class="date-divider"><span>Today</span></div>`;
  msgs.forEach(msg => appendMessageEl(msg, area));
  area.scrollTop = area.scrollHeight;
}

function appendMessageEl(msg, area) {
  if (!area) area = document.getElementById('messages-area');
  const isMe = msg.from === 'me';
  const wrapper = document.createElement('div');
  wrapper.className = 'msg-wrapper ' + (isMe ? 'sent' : 'received');
  wrapper.setAttribute('data-msg-id', msg.id);

  let innerHtml = `<div class="msg-bubble">`;
  if (msg.type === 'sign') {
    innerHtml += `<span class="msg-sign-tag">🤟 ${msg.signLabel || 'Sign'}</span>`;
  }
  innerHtml += escapeHtml(msg.text) + `</div>`;
  innerHtml += `<div class="msg-meta">${msg.time}${isMe ? ' ✓✓' : ''}</div>`;

  if (msg.caption) {
    innerHtml += `<div class="msg-caption"><span>📝 Caption:</span>${escapeHtml(msg.caption)}</div>`;
  }

  wrapper.innerHTML = innerHtml;
  area.appendChild(wrapper);
}

// ── Send Message ──────────────────────────────────────
function sendMessage() {
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text || !state.currentContact) return;

  const msg = {
    id: 'msg_' + Date.now(),
    from: 'me',
    text,
    time: getTime(),
    type: 'text',
    read: true,
  };
  addMessage(msg);
  input.value = '';
  input.style.height = 'auto';
  // simulate reply
  setTimeout(() => simulateReply(), 1200 + Math.random() * 1500);
}

function addMessage(msg) {
  const cid = state.currentContact.id;
  if (!state.messages[cid]) state.messages[cid] = [];
  state.messages[cid].push(msg);
  const area = document.getElementById('messages-area');
  appendMessageEl(msg, area);
  area.scrollTop = area.scrollHeight;
  renderContactList('chats');
}

function simulateReply() {
  if (!state.currentContact) return;
  const contact = state.currentContact;
  const useSign = contact.type === 'mute' || contact.type === 'deafmute';
  const replyTexts = [
    'Got it! 😊', 'That sounds great!', 'Sure, let\'s do that.',
    'Thanks for sharing!', 'I understand.', 'OK! See you then.',
    'That\'s really helpful.', 'Absolutely! 👍'
  ];
  const signTexts = ['Hello', 'Thank You', 'Yes', 'Good', 'Nice to Meet You', 'Happy'];
  const text = useSign
    ? signTexts[Math.floor(Math.random() * signTexts.length)]
    : replyTexts[Math.floor(Math.random() * replyTexts.length)];

  const msg = {
    id: 'msg_' + Date.now(),
    from: contact.id,
    text,
    time: getTime(),
    type: useSign ? 'sign' : 'text',
    signLabel: useSign ? 'ASL: ' + text : undefined,
    caption: useSign ? text : undefined,
    read: true,
  };
  addMessage(msg);
}

function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

// ── Sign Language Input Panel ─────────────────────────
function toggleSignInput() {
  const panel = document.getElementById('sign-input-panel');
  const btn = document.getElementById('sign-toggle-btn');
  const isHidden = panel.classList.contains('hidden');
  panel.classList.toggle('hidden');
  btn.classList.toggle('active', !panel.classList.contains('hidden'));
  if (!isHidden) stopSignCapture();
}

async function startSignCapture() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
    state.signStream = stream;
    const vid = document.getElementById('sign-input-video');
    vid.srcObject = stream;
    startSignSimulation('sign-detected-text');
    showToast('Camera started for sign input 🤟', 'success');
  } catch (e) {
    showToast('Camera access denied. Using simulation mode.', 'error');
    startSignSimulation('sign-detected-text');
  }
}

function stopSignCapture() {
  if (state.signStream) {
    state.signStream.getTracks().forEach(t => t.stop());
    state.signStream = null;
  }
  clearInterval(state.signDetectionInterval);
  document.getElementById('sign-detected-text').textContent = 'Waiting for sign...';
}

function startSignSimulation(targetId) {
  let idx = 0;
  const targetEl = document.getElementById(targetId);
  clearInterval(state.signDetectionInterval);
  state.signDetectionInterval = setInterval(() => {
    const word = SIGN_PHRASES[Math.floor(Math.random() * SIGN_PHRASES.length)];
    if (targetEl) targetEl.textContent = '🤟 Detected: ' + word;
    // auto-queue after 3 detections of same word concept
    if (Math.random() > 0.6) addSignWord(word);
    idx++;
  }, 1800);
}

function addSignWord(word) {
  if (state.signWords.length > 10) return;
  state.signWords.push(word);
  renderSignQueue();
}

function renderSignQueue() {
  const q = document.getElementById('sign-word-queue');
  if (!q) return;
  q.innerHTML = state.signWords.map(w =>
    `<span class="sign-word">${w}</span>`
  ).join('');
}

function clearSignQueue() {
  state.signWords = [];
  renderSignQueue();
}

function sendSignMessage() {
  if (!state.signWords.length || !state.currentContact) return;
  const text = state.signWords.join(' ');
  const msg = {
    id: 'msg_' + Date.now(),
    from: 'me',
    text,
    time: getTime(),
    type: 'sign',
    signLabel: 'ASL Sign',
    read: true,
  };
  addMessage(msg);
  clearSignQueue();
  setTimeout(() => simulateReply(), 1500);
}

// ── Emoji Picker ──────────────────────────────────────
const EMOJIS = ['😊','😂','❤️','👍','🙏','😍','🤟','😭','🎉','🔥','👋','😎','🤔','💯','✨','🫶','🤝','👏','😅','🥰','😢','🤣','😁','🤗','💪','🙌','✅','⭐','🌟','💬','🎊','🌺'];

function toggleEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  const isHidden = picker.classList.contains('hidden');
  picker.classList.toggle('hidden');
  if (isHidden) {
    const grid = document.getElementById('emoji-grid');
    if (!grid.children.length) {
      EMOJIS.forEach(e => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = e;
        btn.onclick = () => insertEmoji(e);
        grid.appendChild(btn);
      });
    }
  }
}

function insertEmoji(emoji) {
  const input = document.getElementById('msg-input');
  input.value += emoji;
  input.focus();
  document.getElementById('emoji-picker').classList.add('hidden');
}

function attachFile() {
  showToast('File sharing coming soon! 📎', 'success');
}

// ── VIDEO CALL ────────────────────────────────────────
async function startVideoCall() {
  if (!state.currentContact) return;
  document.getElementById('chat-view').classList.add('hidden');
  document.getElementById('call-view').classList.remove('hidden');
  document.getElementById('call-contact-name').textContent = '📹 ' + state.currentContact.name;
  document.getElementById('remote-call-avatar').textContent = state.currentContact.avatar;
  document.getElementById('remote-call-name').textContent = 'Connecting to ' + state.currentContact.name + '...';

  state.callActive = true;
  state.callSeconds = 0;
  startCallTimer();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    state.localStream = stream;
    const localVid = document.getElementById('local-video');
    localVid.srcObject = stream;
    document.getElementById('local-placeholder').style.display = 'none';
    // Simulate remote video connecting
    setTimeout(() => {
      document.getElementById('remote-placeholder').innerHTML =
        `<div class="remote-avatar">${state.currentContact.avatar}</div><p>${state.currentContact.name} connected</p>`;
      addCaptionLine(state.currentContact.name, 'Joined the call 🤟');
    }, 2000);
    // Start sign detection on local video
    if (state.signDetectOn) startCallSignDetection();
    showToast('Call started! Sign detection active 🤟', 'success');
  } catch (e) {
    // Fallback simulation when no camera
    document.getElementById('local-placeholder').textContent = '🎭 Simulation Mode';
    setTimeout(() => {
      document.getElementById('remote-placeholder').innerHTML =
        `<div class="remote-avatar">${state.currentContact.avatar}</div><p>${state.currentContact.name} (simulated)</p>`;
      addCaptionLine(state.currentContact.name, 'Joined the call (simulation)');
    }, 2000);
    if (state.signDetectOn) startCallSignDetection();
    showToast('Simulation mode — no camera detected.', 'error');
  }
}

function startVoiceCall() {
  showToast('Voice call starting... 📞', 'success');
  startVideoCall(); // same flow, video can be toggled off
}

function endCall() {
  state.callActive = false;
  clearInterval(state.callTimer);
  if (state.localStream) { state.localStream.getTracks().forEach(t => t.stop()); state.localStream = null; }
  clearInterval(state.signDetectionInterval);
  if (state.speechRunning) stopSpeechRecognition();
  document.getElementById('call-view').classList.add('hidden');
  document.getElementById('chat-view').classList.remove('hidden');
  showToast('Call ended', 'success');
}

function startCallTimer() {
  clearInterval(state.callTimer);
  state.callTimer = setInterval(() => {
    state.callSeconds++;
    const m = String(Math.floor(state.callSeconds / 60)).padStart(2, '0');
    const s = String(state.callSeconds % 60).padStart(2, '0');
    document.getElementById('call-duration').textContent = m + ':' + s;
  }, 1000);
}

// ── Call Controls ─────────────────────────────────────
function toggleMic() {
  state.micOn = !state.micOn;
  const btn = document.getElementById('mic-btn');
  if (state.localStream) {
    state.localStream.getAudioTracks().forEach(t => t.enabled = state.micOn);
  }
  btn.textContent = state.micOn ? '🎙️' : '🔇';
  btn.classList.toggle('muted', !state.micOn);
  showToast(state.micOn ? 'Mic on' : 'Mic muted', 'success');
}

function toggleCam() {
  state.camOn = !state.camOn;
  const btn = document.getElementById('cam-btn');
  if (state.localStream) {
    state.localStream.getVideoTracks().forEach(t => t.enabled = state.camOn);
  }
  btn.textContent = state.camOn ? '📷' : '🚫';
  btn.classList.toggle('muted', !state.camOn);
  showToast(state.camOn ? 'Camera on' : 'Camera off', 'success');
}

function toggleCaptions() {
  state.captionsOn = !state.captionsOn;
  const btn = document.getElementById('caption-toggle-btn');
  btn.classList.toggle('active', state.captionsOn);
  document.getElementById('remote-captions').style.display = state.captionsOn ? 'block' : 'none';
  showToast(state.captionsOn ? 'Captions on' : 'Captions off', 'success');
}

function toggleSignMode() {
  const btn = document.getElementById('sign-mode-btn');
  btn.classList.toggle('active');
  showToast('Sign language mode toggled 🤟', 'success');
}

function toggleSignDetect() {
  state.signDetectOn = !state.signDetectOn;
  const btn = document.getElementById('sign-detect-btn');
  btn.classList.toggle('active', state.signDetectOn);
  const overlay = document.getElementById('sign-detection-overlay');
  overlay.style.display = state.signDetectOn ? 'block' : 'none';
  if (state.signDetectOn) {
    startCallSignDetection();
    showToast('Sign detection ON 🤟', 'success');
  } else {
    clearInterval(state.signDetectionInterval);
    showToast('Sign detection OFF', 'success');
  }
}

function toggleScreenShare() {
  showToast('Screen sharing coming soon! 🖥️', 'success');
}

// ── Call Sign Detection (Simulation) ─────────────────
function startCallSignDetection() {
  clearInterval(state.signDetectionInterval);
  state.signDetectionInterval = setInterval(() => {
    if (!state.callActive) return;
    const word = SIGN_PHRASES[Math.floor(Math.random() * SIGN_PHRASES.length)];
    // Update local detection label
    const label = document.getElementById('detection-label');
    if (label) label.textContent = '🤟 ' + word;
    // Show caption bubble (simulate remote user signing)
    if (Math.random() > 0.5 && state.currentContact) {
      const bubble = document.getElementById('remote-caption-bubble');
      if (bubble) bubble.textContent = state.currentContact.name + ': ' + word;
      addCaptionLine(state.currentContact.name, word);
    }
  }, 2500);
}

function addCaptionLine(speaker, text) {
  const stream = document.getElementById('call-caption-stream');
  if (!stream) return;
  const line = document.createElement('div');
  line.className = 'caption-line new';
  line.innerHTML = `<strong>${speaker}:</strong> <span>${escapeHtml(text)}</span>`;
  stream.appendChild(line);
  stream.scrollTop = stream.scrollHeight;
  // Limit caption lines
  while (stream.children.length > 8) stream.removeChild(stream.firstChild);
  // Fade older lines
  Array.from(stream.children).forEach((el, i, arr) => {
    el.classList.toggle('new', i === arr.length - 1);
  });
}

// ── Speech Recognition ────────────────────────────────
function toggleSpeechRecognition() {
  if (state.speechRunning) {
    stopSpeechRecognition();
  } else {
    startSpeechRecognition();
  }
}

function startSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showToast('Speech recognition not supported in this browser.', 'error');
    simulateSpeechCaptions();
    return;
  }
  state.speechRecognition = new SR();
  state.speechRecognition.continuous = true;
  state.speechRecognition.interimResults = true;
  state.speechRecognition.lang = 'en-US';

  state.speechRecognition.onresult = (event) => {
    let interim = '', final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) { final += t; } else { interim += t; }
    }
    const bubble = document.getElementById('remote-caption-bubble');
    if (bubble) bubble.textContent = interim || final;
    if (final) addCaptionLine('You (speech)', final);
  };

  state.speechRecognition.onerror = () => {
    stopSpeechRecognition();
    simulateSpeechCaptions();
  };

  state.speechRecognition.start();
  state.speechRunning = true;
  updateSpeechUI(true);
  showToast('Speech → Captions active 🎙️', 'success');
}

function stopSpeechRecognition() {
  if (state.speechRecognition) { state.speechRecognition.stop(); state.speechRecognition = null; }
  state.speechRunning = false;
  updateSpeechUI(false);
}

function updateSpeechUI(running) {
  const dot = document.querySelector('.speech-dot');
  const stateEl = document.getElementById('speech-state');
  const btn = document.getElementById('speech-toggle');
  if (dot) dot.classList.toggle('active', running);
  if (stateEl) stateEl.textContent = running ? 'active' : 'inactive';
  if (btn) btn.textContent = running ? 'Stop Speech Captions' : 'Start Speech → Captions';
}

function simulateSpeechCaptions() {
  const phrases = [
    'Hello, how are you today?',
    'It is nice to meet you!',
    'I can see your signs clearly.',
    'The captions are working great.',
    'Let me know if you need help.',
    'This platform is really useful.',
  ];
  state.speechRunning = true;
  updateSpeechUI(true);
  let i = 0;
  const sim = setInterval(() => {
    if (!state.speechRunning || !state.callActive) { clearInterval(sim); return; }
    const bubble = document.getElementById('remote-caption-bubble');
    if (bubble) bubble.textContent = phrases[i % phrases.length];
    addCaptionLine('You (simulated)', phrases[i % phrases.length]);
    i++;
  }, 3000);
}

// ── Landing Page Typing Animation ─────────────────────
const DEMO_CAPTIONS = [
  'Hello, how are you?',
  'Nice to meet you! 🤟',
  'Thank you so much.',
  'I understand you!',
  'Great talking to you!',
];
let captionIdx = 0;
let charIdx = 0;
let typingForward = true;

function runTypingAnimation() {
  const el = document.getElementById('typing-demo');
  if (!el) return;
  const current = DEMO_CAPTIONS[captionIdx];
  if (typingForward) {
    if (charIdx < current.length) {
      el.textContent = current.substring(0, ++charIdx);
      setTimeout(runTypingAnimation, 70);
    } else {
      typingForward = false;
      setTimeout(runTypingAnimation, 1400);
    }
  } else {
    if (charIdx > 0) {
      el.textContent = current.substring(0, --charIdx);
      setTimeout(runTypingAnimation, 35);
    } else {
      typingForward = true;
      captionIdx = (captionIdx + 1) % DEMO_CAPTIONS.length;
      setTimeout(runTypingAnimation, 300);
    }
  }
}

// ── Toast Notification ────────────────────────────────
function showToast(msg, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = (type === 'success' ? '✅ ' : '❌ ') + msg;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'none';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(110%)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Utility ───────────────────────────────────────────
function getTime() {
  const now = new Date();
  return now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Start typing demo on landing
  setTimeout(runTypingAnimation, 800);

  // Smooth scroll polyfill for nav links
  document.querySelectorAll('.nav-links a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      const target = document.querySelector(a.getAttribute('href'));
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Close emoji picker on outside click
  document.addEventListener('click', e => {
    const picker = document.getElementById('emoji-picker');
    if (picker && !picker.classList.contains('hidden')) {
      if (!e.target.closest('#emoji-picker') && !e.target.closest('.tool-btn')) {
        picker.classList.add('hidden');
      }
    }
  });

  console.log('🤟 SignConnect initialized');
});
