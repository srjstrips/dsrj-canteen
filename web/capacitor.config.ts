import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.dsrj.canteen',
  appName: 'Narayani Upahar Gruh',
  webDir: 'dist',
  server: {
    // Point the Android app to your VPS API
    url: 'http://187.53.130.173',
    cleartext: true, // allow HTTP (non-HTTPS) on Android
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
