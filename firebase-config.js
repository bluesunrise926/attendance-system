// ============================================================
// Firebase 設定檔 — 已填入您的專案設定
// 專案名稱：cusineclock
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDRBU7-cKEw0Je9YsjR1Ruj1GFd-6i56mY",
  authDomain: "cusineclock.firebaseapp.com",
  projectId: "cusineclock",
  storageBucket: "cusineclock.firebasestorage.app",
  messagingSenderId: "1065273909620",
  appId: "1:1065273909620:web:58ab926235611f77c4cc21"
};

// 初始化 Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
