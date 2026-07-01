import { initializeApp } from "firebase/app";
import { initializeFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyC7rn39XINhlSaoq2qpMbFv42CjPI5AbuE",
  authDomain: "mesmerizing-arena-ncwq9.firebaseapp.com",
  projectId: "mesmerizing-arena-ncwq9",
  storageBucket: "mesmerizing-arena-ncwq9.firebasestorage.app",
  messagingSenderId: "867923003703",
  appId: "1:867923003703:web:29585a74b35f0044f532b2"
};

const app = initializeApp(firebaseConfig);

// Initialize Firestore with the custom database ID specified in the configuration
const db = initializeFirestore(app, {}, "ai-studio-df6de123-526d-4f42-a470-bc1f9ee95519");

const auth = getAuth(app);

export { app, db, auth };
