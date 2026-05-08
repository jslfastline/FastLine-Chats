# ⚡ FastLine Chats — PWA Messaging Platform

A modern, secure, and futuristic Progressive Web App (PWA) messaging platform built with Vanilla JS and Firebase.

---

## 📁 Project Structure

```
FastLineChats/
├── fast.html              ← Main chat interface (entry point after login)
├── login.html             ← Email OTP login (EmailJS-powered)
├── profile.html           ← New user profile setup
├── style.css              ← Full UI stylesheet (dark/light modes, cyberpunk theme)
├── app.js                 ← Core application logic
├── pwa.js                 ← PWA install prompt, offline detection, SW registration
├── manifest.json          ← PWA manifest (icons, theme, shortcuts)
├── service-worker.js      ← Offline caching & push notifications
├── images/
│   ├── icon-72.png        ← PWA icons (auto-generated)
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png
│   ├── icon-384.png
│   ├── icon-512.png
│   └── default-profile.png
├── scripts/
│   └── firebase-config.js ← Firebase initialization & exports
└── components/
    ├── chat.js            ← Typing indicator, smart replies, swipe-to-reply, date separators
    ├── profile.js         ← Avatar upload, theme manager, WebAuthn, translation
    └── video-call.js      ← WebRTC P2P video/voice calls, call UI, timer
```

---

## 🚀 Setup Instructions

### 1. Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com) and create a project.
2. Enable these Firebase services:
   - **Firestore Database** (start in test mode initially)
   - **Storage** (for avatars, images, voice notes)
3. Register a **Web App** and copy your config.
4. Open `scripts/firebase-config.js` and **replace the placeholder values**:

```js
const firebaseConfig = {
  apiKey:            "YOUR_FIREBASE_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};
```

> Also paste the same config into `login.html` and `profile.html` (the `firebaseConfig` objects inside their `<script type="module">` blocks).

---

### 2. EmailJS Setup

FastLine uses **EmailJS** to send OTP verification codes by email — no backend required.

1. Create a free account at [emailjs.com](https://www.emailjs.com)
2. Create an **Email Service** (Gmail, Outlook, etc.) → note your **Service ID**
3. Create an **Email Template** with these variables:
   - `{{to_email}}` — recipient address
   - `{{to_name}}` — recipient name  
   - `{{otp_code}}` — the 6-digit OTP
   - `{{app_name}}` — will read "FastLine Chats"
4. Note your **Template ID** and **Public Key** (from Account → API Keys)

5. Open `login.html` and replace in this block (around line 529):

```js
window.EMAILJS_PUBLIC_KEY  = "YOUR_PUBLIC_KEY_HERE";
window.EMAILJS_SERVICE_ID  = "YOUR_SERVICE_ID_HERE";
window.EMAILJS_TEMPLATE_ID = "YOUR_TEMPLATE_ID_HERE";
```

---

### 3. Firestore Security Rules (Recommended)

Go to Firebase Console → Firestore → Rules and use:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Users can read/write their own profile
    match /users/{userId} {
      allow read: if request.auth != null || true;  // public reads for search
      allow write: if true;  // lock down in production
    }

    // Conversations: only members can read/write
    match /conversations/{convId} {
      allow read, write: if true;  // tighten in production

      match /messages/{msgId} {
        allow read, write: if true;
      }
    }

    // Calls
    match /calls/{callId} {
      allow read, write: if true;
      match /{sub}/{docId} {
        allow read, write: if true;
      }
    }
  }
}
```

---

### 4. Hosting

#### Option A: Firebase Hosting (recommended)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Set public directory to: .  (current folder)
# Single page app: No
firebase deploy
```

#### Option B: Any Static Host
Upload all files to Netlify, Vercel, GitHub Pages, or any HTTPS server.  
> ⚠️ PWA features (service worker, install prompt) **require HTTPS**.

---

## ✨ Features

| Feature | Status |
|---|---|
| Email OTP Login (EmailJS) | ✅ |
| Real-time Messaging (Firestore) | ✅ |
| Message Read Receipts (✓ ✓✓ 🔵) | ✅ |
| Swipe-to-Reply | ✅ |
| Emoji Picker | ✅ |
| Message Reactions | ✅ |
| Edit & Delete Messages | ✅ |
| Voice Notes (MediaRecorder) | ✅ |
| Image & File Sharing | ✅ |
| Video/Voice Calls (WebRTC) | ✅ |
| Typing Indicators | ✅ |
| Online/Offline Status | ✅ |
| AI Smart Replies | ✅ |
| Dark & Light Mode | ✅ |
| Custom Themes (Cyberpunk/Minimal/Nature) | ✅ |
| Profile Management + Avatar Upload | ✅ |
| PWA (Install on device, offline) | ✅ |
| Push Notifications (local) | ✅ |
| Biometric Login (WebAuthn) | ✅ (register via `BiometricAuth` in profile.js) |
| Real-time Translation | ✅ (via LibreTranslate) |
| Session persistence (30 days) | ✅ |

---

## 🎨 Color Palette

| Element | Color |
|---|---|
| Background (Dark) | `#0E0E10` Deep charcoal |
| Background (Light) | `#F5F6FA` Soft off-white |
| Primary Accent | `#00BFFF` Electric blue |
| Secondary Accent | `#FF6B00` Warm orange |
| Sent Bubble | `#1E90FF → #00BFFF` Gradient |
| Received Bubble | `#2F2F33` Muted gray |
| Reactions | `#FFD700` Gold |

---

## 🔒 Security Notes

- OTP codes expire after **10 minutes**
- Sessions expire after **30 days**
- OTP state uses `sessionStorage` (survives app-switching on mobile)
- Tighten Firestore rules before going to production
- Add TURN servers to `components/video-call.js` for reliable video calls across NAT

---

## 📱 PWA Install

On mobile: open the app in Chrome/Safari → tap the browser menu → **"Add to Home Screen"**  
On desktop: look for the install icon in the address bar.
