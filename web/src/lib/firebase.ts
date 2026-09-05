import { initializeApp } from "firebase/app";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyCBiX2bLnu4a9kI0Ar9d-feZK3N-BHBhug",
  authDomain: "drsrj-canteen.firebaseapp.com",
  projectId: "drsrj-canteen",
  storageBucket: "drsrj-canteen.firebasestorage.app",
  messagingSenderId: "848543380808",
  appId: "1:848543380808:web:c097b5925f450a9a71af7d",
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

const VAPID_KEY = "BPW_4G8PL-5BbJgz_2rtezhGY8g9rywFpEEz0rjV8q3KD33WRRalnzzkJJwvmvfppzUiMdzLZzGfaLl4-PfG1Ho";

/** Request notification permission and return FCM token, or null if denied. */
export async function requestPushToken(): Promise<string | null> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js"),
    });
    return token || null;
  } catch {
    return null;
  }
}

/** Listen for foreground messages and run the callback. */
export function onForegroundMessage(cb: (payload: { title: string; body: string; type: string }) => void) {
  return onMessage(messaging, (payload) => {
    cb({
      title: payload.notification?.title ?? "Notification",
      body: payload.notification?.body ?? "",
      type: (payload.data?.type as string) ?? "",
    });
  });
}
