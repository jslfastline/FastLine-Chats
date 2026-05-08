// ════════════════════════════════════════════════════
//  FastLine Chats — scripts/firebase-config.js
//  Replace ALL placeholder values below with your
//  actual Firebase project credentials.
//  Get them from: https://console.firebase.google.com
//  → Your Project → Project Settings → Your Apps → Web
// ════════════════════════════════════════════════════

import { initializeApp }                          from 'firebase/app';
import { getFirestore }                           from 'firebase/firestore';
import { getStorage }                             from 'firebase/storage';

// ── ★ PASTE YOUR FIREBASE CONFIG HERE ──
const firebaseConfig = {
  apiKey:            "YOUR_FIREBASE_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Initialize Firebase
const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);

export { app, db, storage };
