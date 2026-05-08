import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

// BURAYI FİREBASE'DEN ALDIĞIN KENDİ AYARLARINLA DEĞİŞTİR
const firebaseConfig = {
  apiKey: "SENIN_API_KEY_IN",
  authDomain: "suyapiarsivi.firebaseapp.com",
  projectId: "suyapiarsivi",
  storageBucket: "suyapiarsivi.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:1234567:web:abcde"
};

// Firebase'i başlat
const app = initializeApp(firebaseConfig);

// Veritabanı (Yazıları saklamak için)
export const db = getFirestore(app);
// Depolama (Fotoğrafları saklamak için)
export const storage = getStorage(app);
// Üyelik sistemi (Kimlik doğrulama için)
export const auth = getAuth(app);