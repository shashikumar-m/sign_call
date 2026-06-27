/**
 * SignConnect — Landing Page Logic
 * landing.js
 */
(function () {
  'use strict';

  // Redirect if already logged in
  Auth.redirectIfLoggedIn('app.html');

  // ── Navbar scroll effect ───────────────────────────────────
  const nav = document.getElementById('mainNav');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  // ── Auth modal ─────────────────────────────────────────────
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
    if (isLogin) document.getElementById('loginEmail').focus();
    else document.getElementById('signupName').focus();
  }

  // Button wires
  document.getElementById('btnOpenLogin') .addEventListener('click', () => openModal('login'));
  document.getElementById('btnOpenSignup').addEventListener('click', () => openModal('signup'));
  document.getElementById('btnHeroStart') .addEventListener('click', () => openModal('signup'));
  document.getElementById('btnCtaStart')  .addEventListener('click', () => openModal('signup'));
  document.getElementById('btnCtaLogin')  .addEventListener('click', () => openModal('login'));
  document.getElementById('authModalClose').addEventListener('click', () => UI.Modal.close(modal));

  // Tab switching
  [tabLogin, tabSignup].forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // In-form "switch" links
  modal.querySelectorAll('a[data-tab]').forEach(a => {
    a.addEventListener('click', e => { e.preventDefault(); switchTab(a.dataset.tab); });
  });

  // Auth tab keyboard
  modal.querySelectorAll('.auth-tab').forEach(t => {
    t.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t.click(); }
    });
  });

  // User-type radio styling
  document.querySelectorAll('.user-type-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.user-type-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
    });
  });

  // ── Login form ─────────────────────────────────────────────
  loginPanel.addEventListener('submit', e => {
    e.preventDefault();
    UI.Form.clearErrors(loginPanel);
    const btn = document.getElementById('loginSubmit');
    UI.Form.setLoading(btn, true);

    const data = UI.Form.values(loginPanel);
    const result = Auth.login({
      email: data.email,
      password: data.password,
      remember: data.remember,
    });

    if (result.success) {
      UI.Toast.success('Welcome back, ' + result.user.name + '! 🤟');
      setTimeout(() => window.location.href = 'app.html', 600);
    } else {
      UI.Form.setLoading(btn, false, 'Sign In');
      UI.Form.showErrors(loginPanel, result.errors);
      UI.Toast.error(Object.values(result.errors)[0]);
    }
  });

  // ── Signup form ────────────────────────────────────────────
  signupPanel.addEventListener('submit', e => {
    e.preventDefault();
    UI.Form.clearErrors(signupPanel);
    const btn = document.getElementById('signupSubmit');
    UI.Form.setLoading(btn, true);

    const data = UI.Form.values(signupPanel);
    const result = Auth.signup({
      name:            data.name,
      email:           data.email,
      username:        data.username,
      password:        data.password,
      confirmPassword: data.confirmPassword,
      userType:        data.userType || 'hearing',
    });

    if (result.success) {
      UI.Toast.success('Account created! Welcome, ' + result.user.name + ' 🎉');
      setTimeout(() => window.location.href = 'app.html', 700);
    } else {
      UI.Form.setLoading(btn, false, 'Create Account');
      UI.Form.showErrors(signupPanel, result.errors);
      UI.Toast.error(Object.values(result.errors)[0]);
    }
  });

  // ── Typing animation on hero caption ──────────────────────
  const captionEl = document.getElementById('floatCaption');
  const captions  = ['Signing: Hello', 'I Love You', 'Thank You', 'Good Morning', 'Please Help Me'];
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
      if (ch <= 0) { forward = true; ci = (ci + 1) % captions.length; setTimeout(typeCaption, 400); return; }
      setTimeout(typeCaption, 40);
    }
  }
  setTimeout(typeCaption, 1000);

  // ── Demo chat animation ────────────────────────────────────
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

  // ── Mobile menu ────────────────────────────────────────────
  const mobileBtn  = document.getElementById('mobileMenuBtn');
  const navLinks   = document.getElementById('navLinks');
  let menuOpen = false;
  mobileBtn.addEventListener('click', () => {
    menuOpen = !menuOpen;
    navLinks.style.display = menuOpen ? 'flex' : '';
    navLinks.style.flexDirection = menuOpen ? 'column' : '';
    navLinks.style.position = menuOpen ? 'fixed' : '';
    navLinks.style.top      = menuOpen ? '64px' : '';
    navLinks.style.left     = menuOpen ? '0' : '';
    navLinks.style.right    = menuOpen ? '0' : '';
    navLinks.style.background  = menuOpen ? 'var(--color-bg-2)' : '';
    navLinks.style.padding     = menuOpen ? '20px' : '';
    navLinks.style.borderBottom= menuOpen ? '1px solid var(--color-border)' : '';
    mobileBtn.setAttribute('aria-expanded', menuOpen);
  });

  // ── Intersection observer for section animations ───────────
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('animate-fadeIn');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.feature-card, .step-card').forEach(el => observer.observe(el));

})();
