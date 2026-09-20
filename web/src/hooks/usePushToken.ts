import { useEffect } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../auth/AuthContext";
import { requestPushToken, onForegroundMessage } from "../lib/firebase";
import { api } from "../api/client";
import { useQueryClient } from "@tanstack/react-query";

export function usePushToken() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !window.isSecureContext) return;

    navigator.serviceWorker
      .register("/firebase-messaging-sw.js")
      .then(() => requestPushToken())
      .then((token) => {
        if (token) {
          api.post("/notifications/token", { token }).catch(() => {});
        }
      })
      .catch(() => {});

    // Show toast for foreground notifications and refresh unread count
    const unsub = onForegroundMessage(({ title, body }) => {
      toast(`🔔 ${title}${body ? `\n${body}` : ""}`, { duration: 6000 });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] });
    });

    return () => { unsub(); };
  }, [user?.id]);
}
