// ════════════════════════════════════════════════════
//  FastLine Chats — components/profile.js
//  Profile management: avatar upload, display name,
//  status, active devices, biometric login (WebAuthn)
// ════════════════════════════════════════════════════

// ── Save / Load Profile ──
export async function loadProfile(db, userId) {
  const { doc, getDoc } = await import('firebase/firestore');
  const snap = await getDoc(doc(db, 'users', userId));
  return snap.exists() ? snap.data() : null;
}

export async function saveProfile(db, storage, userId, { displayName, statusMsg, avatarFile }) {
  const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');

  const updates = {
    username:  displayName,
    status:    statusMsg,
    updatedAt: serverTimestamp()
  };

  if (avatarFile) {
    const sRef    = ref(storage, `avatars/${userId}`);
    await uploadBytes(sRef, avatarFile);
    updates.avatar = await getDownloadURL(sRef);
  }

  await updateDoc(doc(db, 'users', userId), updates);
  return updates;
}

// ── Avatar Preview Helper ──
export function previewAvatar(file, imgEl) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) { reject(new Error('Not an image')); return; }
    const reader = new FileReader();
    reader.onload = e => { imgEl.src = e.target.result; resolve(e.target.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Online Status ──
export async function setOnlineStatus(db, userId, isOnline) {
  const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore');
  await updateDoc(doc(db, 'users', userId), {
    online:   isOnline,
    lastSeen: serverTimestamp()
  });
}

// ── Format Last Seen ──
export function formatLastSeen(ts) {
  if (!ts) return 'Long ago';
  const d    = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = Date.now() - d;
  if (diff < 60000)    return 'Just now';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ── User Search (by username prefix or email) ──
export async function searchUsers(db, query, excludeId, limitCount = 10) {
  const { collection, getDocs, query: fsQuery, limit } = await import('firebase/firestore');
  if (!query || query.length < 2) return [];
  const snap = await getDocs(fsQuery(collection(db, 'users'), limit(50)));
  const q    = query.toLowerCase();
  return snap.docs
    .filter(d => d.id !== excludeId)
    .filter(d => {
      const data = d.data();
      return (data.username || '').toLowerCase().includes(q)
          || (data.email    || '').toLowerCase().includes(q);
    })
    .slice(0, limitCount)
    .map(d => ({ id: d.id, ...d.data() }));
}

// ── Biometric / WebAuthn Login ──
export const BiometricAuth = {

  isSupported() {
    return !!(window.PublicKeyCredential && navigator.credentials);
  },

  async register(userId, displayName) {
    if (!this.isSupported()) throw new Error('WebAuthn not supported');
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'FastLine Chats', id: location.hostname },
        user: {
          id: new TextEncoder().encode(userId),
          name: userId,
          displayName
        },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification:        'required'
        },
        timeout: 60000
      }
    });
    // Store credential id in localStorage (production: store on server)
    localStorage.setItem('fastline_biometric_id', arrayToBase64(new Uint8Array(cred.rawId)));
    return cred;
  },

  async authenticate() {
    if (!this.isSupported()) throw new Error('WebAuthn not supported');
    const credId = localStorage.getItem('fastline_biometric_id');
    if (!credId) throw new Error('No biometric registered');
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{
          id:   base64ToArray(credId),
          type: 'public-key'
        }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    return assertion;
  },

  isRegistered() {
    return !!localStorage.getItem('fastline_biometric_id');
  }
};

function arrayToBase64(arr) {
  return btoa(String.fromCharCode(...arr));
}

function base64ToArray(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ── Theme Manager ──
export const ThemeManager = {
  themes: {
    cyberpunk: {
      '--accent':       '#00BFFF',
      '--accent2':      '#FF6B00',
      '--bg':           '#0E0E10',
      '--surface':      '#14141A',
      '--surface-2':    '#1C1C24',
      '--sent-bubble':  'linear-gradient(135deg,#1E90FF,#00BFFF)',
      '--recv-bubble':  '#2F2F33'
    },
    light: {
      '--accent':       '#00BFFF',
      '--accent2':      '#FF6B00',
      '--bg':           '#F5F6FA',
      '--surface':      '#FFFFFF',
      '--surface-2':    '#F0F2F8',
      '--sent-bubble':  'linear-gradient(135deg,#1E90FF,#00BFFF)',
      '--recv-bubble':  '#E8EAEF',
      '--text':         '#0E0E10',
      '--text-muted':   'rgba(14,14,16,0.45)',
      '--text-soft':    'rgba(14,14,16,0.7)',
      '--border':       'rgba(0,191,255,0.2)',
      '--input-bg':     'rgba(0,191,255,0.05)',
      '--shadow':       '0 4px 24px rgba(0,0,0,0.1)'
    },
    minimal: {
      '--accent':       '#6C63FF',
      '--accent2':      '#FF6584',
      '--bg':           '#0A0A0F',
      '--surface':      '#111118',
      '--surface-2':    '#18181F',
      '--sent-bubble':  'linear-gradient(135deg,#6C63FF,#9B59B6)',
      '--recv-bubble':  '#1F1F28'
    },
    nature: {
      '--accent':       '#2ECC71',
      '--accent2':      '#F39C12',
      '--bg':           '#0A0F0C',
      '--surface':      '#101810',
      '--surface-2':    '#182018',
      '--sent-bubble':  'linear-gradient(135deg,#27AE60,#2ECC71)',
      '--recv-bubble':  '#1A2A1A'
    }
  },

  apply(themeName) {
    const theme = this.themes[themeName];
    if (!theme) return;
    const root = document.documentElement;
    Object.entries(theme).forEach(([k, v]) => root.style.setProperty(k, v));
    localStorage.setItem('fastline_theme_name', themeName);
  },

  restore() {
    const saved = localStorage.getItem('fastline_theme_name') || 'cyberpunk';
    this.apply(saved);
  },

  getAll() {
    return Object.keys(this.themes);
  }
};

// ── Real-Time Translation (via LibreTranslate or similar free API) ──
// NOTE: Replace API_URL with your deployed LibreTranslate instance
export async function translateText(text, targetLang = 'en', sourceLang = 'auto') {
  const API_URL = 'https://libretranslate.de/translate'; // Free public instance
  try {
    const res = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ q: text, source: sourceLang, target: targetLang, format: 'text' })
    });
    if (!res.ok) throw new Error('Translation API error');
    const data = await res.json();
    return data.translatedText || text;
  } catch {
    console.warn('[Translation] Failed, returning original');
    return text;
  }
}

// ── Push Notification Permission ──
export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted')  return 'granted';
  if (Notification.permission === 'denied')   return 'denied';
  const result = await Notification.requestPermission();
  return result;
}

export function sendLocalNotification(title, body, icon = 'images/icon-192.png') {
  if (Notification.permission !== 'granted') return;
  if (document.hasFocus()) return; // Don't notify if app is in focus
  new Notification(title, { body, icon, badge: icon, tag: 'fastline-msg' });
}

// ── Status Presets ──
export const STATUS_PRESETS = [
  "Hey there! I'm using FastLine. ⚡",
  "Available 🟢",
  "Busy 🔴",
  "At work 💼",
  "In a meeting 📅",
  "Do not disturb 🚫",
  "On vacation 🌴",
  "Gaming 🎮",
  "Sleeping 😴",
  "Be right back ↩️"
];

// ── Active Device Info ──
export function getDeviceInfo() {
  const ua  = navigator.userAgent;
  let device = 'Unknown Device';
  let os     = 'Unknown OS';

  if (/android/i.test(ua))      { device = 'Android Phone'; os = 'Android'; }
  else if (/iphone/i.test(ua))  { device = 'iPhone';        os = 'iOS'; }
  else if (/ipad/i.test(ua))    { device = 'iPad';          os = 'iPadOS'; }
  else if (/windows/i.test(ua)) { device = 'Windows PC';    os = 'Windows'; }
  else if (/mac/i.test(ua))     { device = 'Mac';           os = 'macOS'; }
  else if (/linux/i.test(ua))   { device = 'Linux PC';      os = 'Linux'; }

  return {
    device,
    os,
    browser: getBrowserName(ua),
    online:  navigator.onLine,
    pwa:     window.matchMedia('(display-mode: standalone)').matches
  };
}

function getBrowserName(ua) {
  if (/chrome/i.test(ua) && !/edg/i.test(ua))  return 'Chrome';
  if (/safari/i.test(ua) && !/chrome/i.test(ua)) return 'Safari';
  if (/firefox/i.test(ua))  return 'Firefox';
  if (/edg/i.test(ua))      return 'Edge';
  if (/opera/i.test(ua))    return 'Opera';
  return 'Browser';
}
