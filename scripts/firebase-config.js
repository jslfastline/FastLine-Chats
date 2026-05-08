import { initializeApp } from './mock-firebase-app.js';

const firebaseConfig = {
  apiKey: "local-mock-key",
  authDomain: "local.app",
  projectId: "fastline-local",
  storageBucket: "local.appspot.com",
  messagingSenderId: "000000000000",
  appId: "1:000000000000:web:0000000000000000000000"
};

const app = initializeApp(firebaseConfig);
const db = { app, _mock: true, _type: 'firestore' };
const storage = { app, _mock: true, host: 'mock' };

export { app, db, storage };
