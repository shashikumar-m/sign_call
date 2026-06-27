/**
 * SignCall — Landing Page Logic (API-backed)
 * landing.js
 */
(function () {
  'use strict';

  // Redirect if already logged in
  API.Auth.redirectIfLoggedIn('app.html');

  // ── Navbar scroll ────────────────────────────────────────────
  const nav = document.getElementById('mainNav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  // ── Auth modal ───────────────────────────────────────────────
  const modal       = document.getElementById('authModal');
  const loginPanel  = document.getElementById('loginPanel');
  const signupPanel = document.getElementById('signupPanel');
  const tabLogin    = document.getElementById('tabLogin');
  const tabSignup   = document.getElementById('tabSignup');

  function openModal(tab = 'login') {
    UI.Modal.open(modal);
    switchTab(tab);
  }

  function switchTab(tab) {
    const isLogin = tab === 'login';
    loginPanel .classList.toggle('active', isLogin);
    signupPanel.classList.toggle('active', !isLogin);
    tabLogin .classList.toggle('active', isLogin);
    tabLogin .setAttribute('aria-selected', isLogin);
    tabSignup.classList.toggle('active', !isLogin);
    tabSignup.setAttribute('aria-selected', !isLogin);
    UI.Form.clearErrors(isLogin ? loginPanel : signupPanel);
  }

  document.getElementById('btnOpenLogin') .addEventListener('click', () => openModal('login'));
  document.getElementById('btnOpenSignup').addEventListener('click', () => openModal('signup'));
  document.getElementById('btnHeroStart') .addEventListener('click', () => openModal('signup'));
  document.getElementById('btnCtaStart')  .addEventListener('click', () => openModal('signup'));
  document.getElementById('btnCtaLogin')  .addEventListener('click', () => openModal('login'));
  document.getElementById('authModalClose').addEventListener('click', () => UI.Modal.close(modal));

  [tabLogin, tabSignup].forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.tab));
  });

  modal.querySelectorAll('a[data-tab]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); switchTab(a.dataset.tab); });
  });

  // User-type radio styling
  document.querySelectorAll('.user-type-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.user-type-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });

  // ── Login form ───────────────────────────────────────────────
  loginPanel.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.Form.clearErrors(loginPanel);
    const btn = document.getElementById('loginSubmit');
    UI.Form.setLoading(btn, true);

    try {
      const data = UI.Form.values(loginPanel);
      await API.Auth.login({ email: data.email, password: data.password });
      UI.Toast.success('Welcome back! 🤟');
      setTimeout(() => window.location.href = 'app.html', 500);
    } catch (err) {
      UI.Form.setLoading(btn, false, 'Sign In');
      const errors = {};
      if (err.field) errors[err.field] = err.message;
      else errors.email = err.message;
      UI.Form.showErrors(loginPanel, errors);
      UI.Toast.error(err.message);
    }
  });

  // ── Signup form ──────────────────────────────────────────────
  signupPanel.addEventListener('submit', async (e) => {
    e.preventDefault();
    UI.Form.clearErrors(signupPanel);
    const btn = document.getElementById('signupSubmit');
    UI.Form.setLoading(btn, true);

    try {
      const data = UI.Form.values(signupPanel);
      const user = await API.Auth.signup({
        name:            data.name,
        email:           data.email,
        username:        data.username,
        password:        data.password,
        confirmPassword: data.confirmPassword,
        userType:        data.userType || 'hearing',
      });
      UI.Toast.success(`Account created! Welcome, ${user.name} 🎉`);
      setTimeout(() => window.location.href = 'app.html', 600);
    } catch (err) {
      UI.Form.setLoading(btn, false, 'Create Account');
      const errors = {};
      if (err.field) errors[err.field] = err.message;
      UI.Form.showErrors(signupPanel, errors);
      UI.Toast.error(err.message);
    }
  });

  // ── Typing animation ─────────────────────────────────────────
  const captionEl = document.getElementById('floatCaption');
  const captions  = ['Signing: Hello', 'I Love You', 'Thank You', 'Good Morning', 'Please Help'];
  let ci = 0, ch = 0, forward = true;
  function typeCaption() {
    if (!captionEl) return;
    const str = captions[ci];
    if (forward) {
      captionEl.textContent = str.slice(0, ++ch);
      if (ch >= str.length) { forward = false; setTimeout(typeCaption, 1600); return; }
      setTimeout(typeCaption, 80);
    } else {
      captionEl.textContent = str.slice(0, --ch);
      if (ch <= 0) { forward = true; ci = (ci+1) % captions.length; setTimeout(typeCaption, 400); return; }
      setTimeout(typeCaption, 40);
    }
  }
  setTimeout(typeCaption, 1000);

  // Demo input typing
  const demoInput = document.getElementById('demoInput');
  const demoPhrases = ['Hello! Nice to meet you', 'Can you see my signs?', 'How are you today?'];
  let di = 0, dc = 0;
  function typeDemo() {
    if (!demoInput) return;
    const str = demoPhrases[di % demoPhrases.length];
    if (dc < str.length) {
      demoInput.value = str.slice(0, ++dc);
      setTimeout(typeDemo, 60);
    } else {
      setTimeout(() => { demoInput.value = ''; dc = 0; di++; typeDemo(); }, 2200);
    }
  }
  setTimeout(typeDemo, 2500);

  // Intersection observer animations
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('animate-fadeIn'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.feature-card, .step-card').forEach(el => observer.observe(el));

})();
