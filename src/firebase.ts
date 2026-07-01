import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDzn52Q9N7YrQnwb8e2sZBrrYlITc1W2EM",
  authDomain: "mafyaa-7d6db.firebaseapp.com",
  projectId: "mafyaa-7d6db",
  storageBucket: "mafyaa-7d6db.firebasestorage.app",
  messagingSenderId: "98422478965",
  appId: "1:98422478965:web:91522b74dc4bdc25af803c",
  measurementId: "G-WP07JCP42N"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
