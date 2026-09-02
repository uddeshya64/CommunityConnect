import "dotenv/config";
import webpush from 'web-push';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Setup VAPID Keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY || "BKL-vi_3IazNVKj_m2ZYkZ1PNAxsnWuRscC8LQixLE6dNYl7-pxo8N6lcbmr7MVLj9dDY7lS5UsVokG8JDk0faU";
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || "jZBpbmOzb4N4YCplub12pDoGraDKwIEasiOggXXFofk";
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:support@communityconnect.dev';

try {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
} catch (err) {
  console.error('Error setting VAPID details:', err);
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
  actions?: Array<{ action: string; title: string }>;
  data?: Record<string, any>;
}

export const PushService = {
  getVapidPublicKey(): string {
    return vapidPublicKey || '';
  },

  async saveSubscription(
    userId: number,
    data: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      device?: string;
      userAgent?: string;
    }
  ) {
    return await prisma.pushSubscription.upsert({
      where: { endpoint: data.endpoint },
      update: {
        user_id: userId,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        device: data.device || null,
        user_agent: data.userAgent || null,
      },
      create: {
        user_id: userId,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        device: data.device || null,
        user_agent: data.userAgent || null,
      },
    });
  },

  async removeSubscription(endpoint: string) {
    try {
      await prisma.pushSubscription.deleteMany({
        where: { endpoint },
      });
      return true;
    } catch (e) {
      return false;
    }
  },

  async sendPushToUser(userId: number, payload: PushPayload) {
    try {
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { user_id: userId },
      });

      if (!subscriptions || subscriptions.length === 0) {
        return { count: 0, successful: 0 };
      }

      const stringifiedPayload = JSON.stringify({
        title: payload.title || 'CommunityConnect Alert',
        body: payload.body || '',
        icon: payload.icon || '/icons/icon-192x192.png',
        badge: payload.badge || '/icons/badge-72x72.png',
        url: payload.url || 'https://community-connect-frontend-5oe1-beta.vercel.app/notifications',
        tag: payload.tag || `cc-alert-${Date.now()}`,
        actions: payload.actions || [{ action: 'open', title: 'View' }],
        data: payload.data || {},
      });

      let successful = 0;
      const invalidEndpointIds: number[] = [];

      for (const sub of subscriptions) {
        try {
          const pushSubscriptionObj = {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          };

          await webpush.sendNotification(pushSubscriptionObj, stringifiedPayload);
          successful++;
        } catch (err: any) {
          // If subscription is expired or unsubscribed (410 Gone / 404 Not Found), prune it
          if (err.statusCode === 410 || err.statusCode === 404) {
            invalidEndpointIds.push(sub.id);
          } else {
            console.error(`Failed to send push to subscription ${sub.id}:`, err.message);
          }
        }
      }

      if (invalidEndpointIds.length > 0) {
        await prisma.pushSubscription.deleteMany({
          where: { id: { in: invalidEndpointIds } },
        });
      }

      return { count: subscriptions.length, successful };
    } catch (err: any) {
      console.error(`PushService.sendPushToUser error for user ${userId}:`, err);
      return { count: 0, successful: 0, error: err.message };
    }
  },

  async sendPushToEmail(email: string, payload: PushPayload) {
    try {
      const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase().trim() },
        select: { id: true },
      });

      if (!user) {
        return { count: 0, successful: 0 };
      }

      return await this.sendPushToUser(user.id, payload);
    } catch (err: any) {
      console.error(`PushService.sendPushToEmail error for email ${email}:`, err);
      return { count: 0, successful: 0, error: err.message };
    }
  },
};
