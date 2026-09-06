import { initializeApp, getApps } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCBiX2bLnu4a9kI0Ar9d-feZK3N-BHBhug",
  authDomain: "drsrj-canteen.firebaseapp.com",
  projectId: "drsrj-canteen",
  storageBucket: "drsrj-canteen.firebasestorage.app",
  messagingSenderId: "848543380808",
  appId: "1:848543380808:web:c097b5925f450a9a71af7d",
};

const VAPID_KEY = "BPW_4G8PL-5BbJgz_2rtezhGY8g9rywFpEEz0rjV8q3KD33WRRalnzzkJJwvmvfppzUiMdzLZzGfaLl4-PfG1Ho";

function isMessagingSupported() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "Notification" in window &&
    "PushManager" in window
  );
}

function getApp() {
  if (!getApps().length) return initializeApp(firebaseConfig);
  return getApps()[0];
}

export async function requestPushToken(): Promise<string | null> {
  if (!isMessagingSupported()) return null;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const messaging = getMessaging(getApp());
    const swReg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js");
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });
    return token || null;
  } catch {
    return null;
  }
}

export function onForegroundMessage(cb: (payload: { title: string; body: string; type: string }) => void) {
  if (!isMessagingSupported()) return () => {};
  try {
    const messaging = getMessaging(getApp());
    return onMessage(messaging, (payload) => {
      cb({
        title: payload.notification?.title ?? "Notification",
        body: payload.notification?.body ?? "",
        type: (payload.data?.type as string) ?? "",
      });
    });
  } catch {
    return () => {};
  }
}
