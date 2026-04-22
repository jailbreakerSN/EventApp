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
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const firebaseAuth = getAuth(app);
export const firebaseStorage = getStorage(app);

const useEmulators =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

// Firestore client. Mirrors the web-backoffice setup — `initializeFirestore`
// with persistent IndexedDB cache + multi-tab manager so the bell's real-
// time listener (see src/hooks/use-notification-live-stream.ts) survives
// tab reloads without a cold refetch, and two tabs on the same browser
// share the local snapshot cache. Persistence is disabled against the
// emulator to avoid IndexedDB version conflicts during local resets.
export const firestore = initializeFirestore(app, {
  localCache: useEmulators
    ? undefined
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

if (useEmulators) {
  connectAuthEmulator(firebaseAuth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(firestore, "localhost", 8080);
  connectStorageEmulator(firebaseStorage, "localhost", 9199);
}

// Firebase Cloud Messaging (Phase C.2 — Web Push). Lazy accessor because
// the SDK probes `indexedDB` + `serviceWorker` availability at import, and
// both are undefined during SSR or in incognito/iOS-Safari-pre-16.4. The
// `isSupported()` check short-circuits those environments to `null` so the
// push hook can render a graceful "unsupported" state instead of crashing.
export const getFirebaseMessaging = async () => {
  if (typeof window === "undefined") return null;
  const supported = await isSupported();
  return supported ? getMessaging(app) : null;
};
