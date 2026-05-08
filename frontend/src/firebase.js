import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDMgoQvitvm8hIwz1jv03LSeO3j8EpMvGo",
  authDomain: "suarsivi.firebaseapp.com",
  projectId: "suarsivi",
  storageBucket: "suarsivi.firebasestorage.app",
  messagingSenderId: "935159384605",
  appId: "1:935159384605:web:3839abb868a36f6c2a94f4"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);