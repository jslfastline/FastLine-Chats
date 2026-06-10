/** Shared session + remembered email for FastLine auth */
export const SESSION_EMAIL_KEY = 'fastline_session_email';
export const SESSION_EXPIRY_KEY = 'fastline_session_expiry';
export const LAST_EMAIL_KEY = 'fastline_last_email';
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

export function saveSession(email) {
  const e = normalizeEmail(email);
  localStorage.setItem(SESSION_EMAIL_KEY, e);
  localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + SESSION_DURATION_MS));
  localStorage.setItem(LAST_EMAIL_KEY, e);
}

export function getSession() {
  const e = localStorage.getItem(SESSION_EMAIL_KEY);
  const x = +localStorage.getItem(SESSION_EXPIRY_KEY);
  if (!e || !x || Date.now() >= x) {
    clearSession(false);
    return null;
  }
  return e;
}

export function clearSession(clearRemembered = true) {
  localStorage.removeItem(SESSION_EMAIL_KEY);
  localStorage.removeItem(SESSION_EXPIRY_KEY);
  if (clearRemembered) localStorage.removeItem(LAST_EMAIL_KEY);
}

export function getRememberedEmail() {
  return localStorage.getItem(LAST_EMAIL_KEY) || '';
}

export function emailToId(email) {
  return normalizeEmail(email).replace(/[^a-z0-9]/g, '_');
}

export function isProfileComplete(user) {
  const hasUsername = !!(user?.username || '').trim();
  const hasAvatar = !!(user?.avatar || '').trim();
  return hasUsername && hasAvatar;
}
