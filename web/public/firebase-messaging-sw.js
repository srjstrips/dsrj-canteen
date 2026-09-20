importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCBiX2bLnu4a9kI0Ar9d-feZK3N-BHBhug",
  authDomain: "drsrj-canteen.firebaseapp.com",
  projectId: "drsrj-canteen",
  storageBucket: "drsrj-canteen.firebasestorage.app",
  messagingSenderId: "848543380808",
  appId: "1:848543380808:web:c097b5925f450a9a71af7d",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title = "Notification", body = "" } = payload.notification ?? {};
  self.registration.showNotification(title, {
    body,
    icon: "/icon-192.svg",
    badge: "/icon-192.svg",
    vibrate: [200, 100, 200],
    tag: payload.data?.type ?? "dsrj-notification",
    data: payload.data,
    requireInteraction: false,
  });
});
