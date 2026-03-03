/* ============================================================
   FIREBASE CONFIGURATION — Stone Game Multiplayer
   ============================================================
   Firebase v10 modular SDK via CDN (ESM imports)
   ============================================================ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Firebase project configuration ─────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBaT2AJHDFB_YfB76r21Ht4N_PyFJPiRQQ",
  authDomain: "stone-game-multiplayer.firebaseapp.com",
  projectId: "stone-game-multiplayer",
  storageBucket: "stone-game-multiplayer.firebasestorage.app",
  messagingSenderId: "513220478084",
  appId: "1:513220478084:web:7d0b660ed969f469c6eed1",
  measurementId: "G-Z2WDNG5S27"
};

// ── Initialize Firebase services ────────────────────────────
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ── Export everything needed by script.js ────────────────────
export {
  auth,
  db,
  googleProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  increment
};