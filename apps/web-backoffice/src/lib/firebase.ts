import { initializeApp, getApps } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
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

// Use initializeFirestore with persistence built in (replaces deprecated enableIndexedDbPersistence)
const useEmulators =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

export const firestore = initializeFirestore(app, {
  localCache: useEmulators
    ? undefined // skip persistence when using emulators (avoids conflicts)
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const firebaseStorage = getStorage(app);

// Connect to emulators BEFORE any other Firestore/Auth/Storage calls
if (useEmulators) {
  connectAuthEmulator(firebaseAuth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "localhost", 8080);
  connectStorageEmulator(firebaseStorage, "localhost", 9199);
}

// FCM (only in browser, and only if supported)
export const getFirebaseMessaging = async () => {
  if (typeof window === "undefined") return null;
  const supported = await isSupported();
  return supported ? getMessaging(app) : null;
};
