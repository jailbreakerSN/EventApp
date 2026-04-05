import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const firebaseAuth = getAuth(app);
export const firestore = getFirestore(app);
export const firebaseStorage = getStorage(app);

// Enable offline persistence for web (PWA)
if (typeof window !== "undefined") {
  enableIndexedDbPersistence(firestore).catch((err) => {
    if (err.code === "failed-precondition") {
      console.warn("Firestore persistence: multiple tabs open");
    } else if (err.code === "unimplemented") {
      console.warn("Firestore persistence: not supported in this browser");
    }
  });
}

// FCM (only in browser, and only if supported)
export const getFirebaseMessaging = async () => {
  if (typeof window === "undefined") return null;
  const supported = await isSupported();
  return supported ? getMessaging(app) : null;
};

// Connect to emulators in development
if (
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_USE_EMULATORS === "true"
) {
  connectAuthEmulator(firebaseAuth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "localhost", 8080);
  connectStorageEmulator(firebaseStorage, "localhost", 9199);
}
