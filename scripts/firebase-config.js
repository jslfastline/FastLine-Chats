// FastLine Chats — shared Firebase (cloud Firestore + Storage)
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

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

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

export { app, db, storage };
