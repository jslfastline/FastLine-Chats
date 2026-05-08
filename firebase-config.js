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
  apiKey: "AIzaSyBFvBk2ONWQ_oZO7qKHf_3E47htyenr6-c",
  authDomain: "fastline-2a654.firebaseapp.com",
  databaseURL: "https://fastline-2a654-default-rtdb.firebaseio.com",
  projectId: "fastline-2a654",
  storageBucket: "fastline-2a654.firebasestorage.app",
  messagingSenderId: "547975856263",
  appId: "1:547975856263:web:71c898f5f900fa3d777822",
  measurementId: "G-2VWHTEJ69D"
};

// Initialize Firebase
const app     = initializeApp(firebaseConfig);
const db      = getFirestore(app);
const storage = getStorage(app);

export { app, db, storage };
