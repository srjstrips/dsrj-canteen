import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { cert } from "firebase-admin/app";
import { getMessaging, SendResponse } from "firebase-admin/messaging";
import { pool, query } from "../db/pool";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: "drsrj-canteen",
      clientEmail: "firebase-adminsdk-fbsvc@drsrj-canteen.iam.gserviceaccount.com",
      privateKey:
        "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC/kwmRB/foj/la\nMBO/P6obDi12rN0Ox8jAQ+c+QC047QP1AIU7uO5LxDMfnNJFSC+85miV3ATY56k9\nwpAddaIfpZDBq/S3xttPDY6dCSQsttP08a7k1yCya7ivQez1O80zvgwzsTXrMWXP\n1O6Hgqn0+5iuV51IxAgOdStsJ5Ys/sBNIh+Y+oSEegupaof+lKd7CPBbZwV2IB7N\nuJHcYmxAeuqNALt6OB0ZtUgUIyzjB1bvrqEXRaoCGFBj5uBXFslyIR1Ddd6YoyPk\nDNWTxSUUNFmLAW4CwGLx4x1f0Yx5hK2mS9MadNqfNSSG2tR2lHDRYs5//J06W3qo\n7rF86okDAgMBAAECggEAPcs8fTsgRLRYHra+T+TFxmda09prja50u0vL5eEGlUOi\nkJ9D2qFKwEa/pNVNYAqqV1jM6HXpXFvRU/oTyWTd0C50FHyWeccbi5LYax/9Oq0Y\njnx8yRT5V4P2tRVjTTEmfiexwOTK+xvaduD8tdo4XyzesXHSapvM63jw8jiMsONF\nqcZg4HEXY1IUiSRkjZ9lbEc5UQhHJEwN/OSdbqmeEXO2QdnvO8bbHJyi6lG5H04V\nF0whQ/9CWCv2/DspfgqLOj+l2X1PSmMRMu2KPrkRlPKa+lQgrN+M22242I9SLgDp\nyjggx+6tip9v28eBN3taYxWPRNpYRb0/Uw7PMAvc6QKBgQD4o13o6DdNshLaXLey\nrvCLAMyy37Sw2zs183U30ijfvV0ixqOJW+PSmwnrNagIPhGbjDAElKgTL05yjzIL\nm7ZYWN1HbcZ6+6ArN0hD3Fc6xwzoM+DQftvZlcHzq+zl51kTMtP3UpfSM/kT3J96\nYWGV/OJQKPEo98U1csX8cXw5GwKBgQDFPyMbIuNLsdC9QjM1le2kjkgc53NU/d35\nH4A+OdQnpA1eZg6EEIK44lmgM41kx1yssENw5PeGtjq2Qkzk2RHw+iGwm1fWFL04\n/cZm2x6wDth/k5RTm5CqbsD5xI3204br6FZIkHwXp90faAQOunH63KP4vLaPscHA\nKsSVpSSWOQKBgQDGoZxwaLNlupEdKV0HvoIkSis960Fq2HlhDHHkelx1Ac7Z7V7Q\naTyED5/I7ECk9RET9taVkj0DtpMxKfyNEYSG59c/LQ+XSFYYsD1nGSwGpOZGyssb\nRX1VQjKD/CFxOXULxVtZBf6Ly0F9AI/XMNzI+hHCgDLIy8gcfuh0WCUpaQKBgE0+\ncYASBJNDGmzTfPxyL3Nu6Nyw4yCYnpIN/QnhWa0AeN/L9clQMfE3a0PqjGe4Dxnt\nmSuf7zOJL6rqgfRo8ba+Le1cmGRVENk9wLHNA9KMrcogQEkRtfCYmOf3SmUr5z2B\najDWrFITQewnrtcZusM0Ht6tAI17XlXkKcI0vwQ5AoGBAM7JTA4yKOboBaU0q8tZ\nCh5x8FsXolaRUwMWJ5qt9NQb3kCBBBUoZmSR2KekfasRIdNXuHkiM/wIa/+ZirRl\nkY2+1q44J65ekszQIle1VjN/5yNZo7ruuTwDf8tXwtNq2rlWoiyrKkhoxOeaiq3U\nD4Fv0OwtW9JNPgdrxiS7DxVW\n-----END PRIVATE KEY-----\n",
    }),
  });
}

export type NotificationType =
  | "STOCK_RECEIVED"
  | "POS_SALE"
  | "CONTRACTOR_LABOUR"
  | "ORDER_PLACED"
  | "EXTRA_RESOLVED"
  | "TOKEN_TOPUP";

export interface NotifyPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  userIds?: string[];
  targetRoles?: string[];
}

export async function sendNotification(payload: NotifyPayload): Promise<void> {
  try {
    let userIds = payload.userIds ?? [];

    if (payload.targetRoles && payload.targetRoles.length > 0) {
      const rolePlaceholders = payload.targetRoles.map((_, i) => `$${i + 1}`).join(", ");
      const users = await query<{ id: string }>(
        pool,
        `SELECT id FROM users WHERE role IN (${rolePlaceholders}) AND active = TRUE`,
        payload.targetRoles
      );
      userIds = [...new Set([...userIds, ...users.map((u) => u.id)])];
    }

    if (userIds.length === 0) return;

    for (const userId of userIds) {
      await pool.query(
        `INSERT INTO notifications (user_id, type, title, body, data)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, payload.type, payload.title, payload.body, payload.data ? JSON.stringify(payload.data) : null]
      );
    }

    const tokenRows = await query<{ token: string }>(
      pool,
      `SELECT token FROM fcm_tokens WHERE user_id = ANY($1)`,
      [userIds]
    );

    if (tokenRows.length === 0) return;

    const tokens = tokenRows.map((r) => r.token);
    const messaging = getMessaging(getApp());
    const batchSize = 500;

    for (let i = 0; i < tokens.length; i += batchSize) {
      const batch = tokens.slice(i, i + batchSize);
      try {
        const response = await messaging.sendEachForMulticast({
          tokens: batch,
          notification: { title: payload.title, body: payload.body },
          data: { type: payload.type, ...(payload.data ?? {}) },
          webpush: {
            notification: {
              title: payload.title,
              body: payload.body,
              icon: "/icon-192.png",
              badge: "/icon-192.png",
            },
            fcmOptions: { link: "/" },
          },
        });

        const invalidTokens = response.responses
          .map((r: SendResponse, idx: number) => ({ r, idx }))
          .filter(({ r }) =>
            !r.success &&
            (r.error?.code === "messaging/invalid-registration-token" ||
              r.error?.code === "messaging/registration-token-not-registered")
          )
          .map(({ idx }) => batch[idx]);

        if (invalidTokens.length > 0) {
          await pool.query(`DELETE FROM fcm_tokens WHERE token = ANY($1)`, [invalidTokens]);
        }
      } catch {
        // FCM errors must not break the main request
      }
    }
  } catch {
    // Notification errors must never crash the main request
  }
}
