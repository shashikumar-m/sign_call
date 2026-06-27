/**
 * SignConnect — Authentication Module
 * auth.js
 *
 * Handles signup, login, logout, session management.
 * Uses DB.Users for persistence and sessionStorage for session.
 */

const Auth = (() => {
  const SESSION_KEY = 'sc_session';

  // ── Session helpers ───────────────────────────────────────────
  const getSession = () => {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  };

  const setSession = (user) => {
    const pub = DB.Users.publicProfile(user);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(pub));
    return pub;
  };

  const clearSession = () => {
    sessionStorage.removeItem(SESSION_KEY);
  };

  // ── Public API ────────────────────────────────────────────────
  const isLoggedIn = () => !!getSession();

  const currentUser = () => getSession();

  const requireAuth = () => {
    if (!isLoggedIn()) {
      window.location.href = 'index.html';
      return null;
    }
    return currentUser();
  };

  const redirectIfLoggedIn = (dest = 'app.html') => {
    if (isLoggedIn()) window.location.href = dest;
  };

  // ── Validation ────────────────────────────────────────────────
  const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const validatePassword = (pw) => {
    if (pw.length < 6) return 'Password must be at least 6 characters';
    return null;
  };

  const validateName = (name) => {
    if (!name || name.trim().length < 2) return 'Name must be at least 2 characters';
    return null;
  };

  // ── Signup ────────────────────────────────────────────────────
  const signup = ({ name, email, password, confirmPassword, userType, username }) => {
    const errors = {};

    const nameErr = validateName(name);
    if (nameErr) errors.name = nameErr;

    if (!validateEmail(email)) errors.email = 'Please enter a valid email';

    const existing = DB.Users.findByEmail(email);
    if (existing) errors.email = 'An account with this email already exists';

    if (username) {
      const existingUsername = DB.Users.findByUsername(username);
      if (existingUsername) errors.username = 'This username is already taken';
      if (!/^[a-z0-9_]{3,20}$/i.test(username)) errors.username = 'Username: 3-20 chars, letters/numbers/underscores only';
    }

    const pwErr = validatePassword(password);
    if (pwErr) errors.password = pwErr;

    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match';

    if (Object.keys(errors).length > 0) return { success: false, errors };

    const user = DB.Users.create({ name, email, password, userType: userType || 'hearing', username });
    DB.Presence.set(user.id, 'online');
    const session = setSession(user);
    return { success: true, user: session };
  };

  // ── Login ─────────────────────────────────────────────────────
  const login = ({ email, password, remember }) => {
    if (!email || !password) {
      return { success: false, errors: { email: 'Please fill in all fields' } };
    }

    const user = DB.Users.verify(email, password);
    if (!user) {
      return { success: false, errors: { email: 'Invalid email or password' } };
    }

    DB.Presence.set(user.id, 'online');
    const session = setSession(user);

    if (remember) {
      // Persist across browser restarts using localStorage
      localStorage.setItem('sc_remember', JSON.stringify(session));
    }

    return { success: true, user: session };
  };

  // ── Logout ────────────────────────────────────────────────────
  const logout = () => {
    const user = currentUser();
    if (user) DB.Presence.setOffline(user.id);
    clearSession();
    localStorage.removeItem('sc_remember');
    window.location.href = 'index.html';
  };

  // ── Auto-login from remembered session ───────────────────────
  const autoLogin = () => {
    if (isLoggedIn()) return true;
    try {
      const remembered = JSON.parse(localStorage.getItem('sc_remember'));
      if (remembered && remembered.id) {
        // Verify user still exists
        const user = DB.Users.get(remembered.id);
        if (user) {
          setSession(user);
          return true;
        }
      }
    } catch {}
    return false;
  };

  // ── Update profile ────────────────────────────────────────────
  const updateProfile = (updates) => {
    const user = currentUser();
    if (!user) return { success: false };
    const updated = DB.Users.update(user.id, updates);
    setSession(updated);
    return { success: true, user: DB.Users.publicProfile(updated) };
  };

  // ── Refresh session from DB ───────────────────────────────────
  const refreshSession = () => {
    const session = getSession();
    if (!session) return null;
    const fresh = DB.Users.get(session.id);
    if (!fresh) { clearSession(); return null; }
    return setSession(fresh);
  };

  return {
    signup,
    login,
    logout,
    autoLogin,
    updateProfile,
    refreshSession,
    isLoggedIn,
    currentUser,
    requireAuth,
    redirectIfLoggedIn,
  };
})();

window.Auth = Auth;
