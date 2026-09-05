import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { requestPushToken } from "../lib/firebase";
import { api } from "../api/client";

export function usePushToken() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .then(() => requestPushToken())
      .then((token) => {
        if (token) {
          api.post("/notifications/token", { token }).catch(() => {});
        }
      })
      .catch(() => {});
  }, [user?.sub]);
}
