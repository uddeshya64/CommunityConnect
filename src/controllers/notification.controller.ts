import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { PushService } from '../services/push.service';

const prisma = new PrismaClient();

export const NotificationController = {
  async getNotifications(req: Request, res: Response) {
    try {
      const userId = req.user!.id;

      // 1. Fetch user to get their email address
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const email = user.email;

      // 2. Fetch pending team invites
      const teamInvites = await prisma.teamInvite.findMany({
        where: {
          email: email,
          status: 'pending',
          expires_at: { gt: new Date() }
        },
        include: {
          team: {
            include: {
              event: {
                select: {
                  title: true,
                  banner_url: true
                }
              }
            }
          }
        }
      });

      // 3. Fetch pending staff invites
      const staffInvites = await prisma.eventStaffInvite.findMany({
        where: {
          email: email,
          status: 'pending',
          expires_at: { gt: new Date() }
        },
        include: {
          event: {
            select: {
              title: true,
              banner_url: true
            }
          },
          role: {
            select: {
              name: true
            }
          }
        }
      });

      // 4. Fetch active staff assignments / role updates
      const staffRoles = await prisma.eventUserRole.findMany({
        where: { user_id: userId },
        include: {
          event: { select: { id: true, title: true, banner_url: true } },
          role: { select: { name: true } }
        },
        orderBy: { assigned_at: 'desc' }
      });

      // 5. Format them consistently
      const teamInvitesFormatted = teamInvites.map(ti => ({
        id: `team_${ti.id}`,
        type: 'TEAM_INVITE',
        token: ti.token,
        teamName: ti.team.name,
        eventName: ti.team.event.title,
        eventBanner: ti.team.event.banner_url || null,
        created_at: ti.created_at,
        expires_at: ti.expires_at
      }));

      const staffInvitesFormatted = staffInvites.map(si => ({
        id: `staff_${si.id}`,
        type: 'STAFF_INVITE',
        token: si.token,
        roleName: si.role.name,
        eventName: si.event.title,
        eventBanner: si.event.banner_url || null,
        created_at: si.created_at,
        expires_at: si.expires_at
      }));

      const roleUpdatesFormatted = staffRoles.map(sr => ({
        id: `role_${sr.id}`,
        type: 'ROLE_UPDATE',
        eventId: sr.event.id,
        roleName: sr.role.name,
        eventName: sr.event.title,
        eventBanner: sr.event.banner_url || null,
        created_at: sr.assigned_at
      }));

      // 6. Combine and sort by date descending
      const allNotifications = [...teamInvitesFormatted, ...staffInvitesFormatted, ...roleUpdatesFormatted].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      res.json({ success: true, data: allNotifications });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async getPushStatus(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const count = await prisma.pushSubscription.count({
        where: { user_id: userId },
      });
      res.json({ success: true, isSubscribed: count > 0, count });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async getVapidPublicKey(req: Request, res: Response) {
    try {
      const publicKey = PushService.getVapidPublicKey();
      res.json({ success: true, publicKey });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async subscribePush(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { subscription, device, userAgent } = req.body;

      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ error: "Invalid push subscription object." });
      }

      const saved = await PushService.saveSubscription(userId, {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
        device: device || 'browser',
        userAgent: userAgent || req.headers['user-agent'],
      });

      res.json({ success: true, message: "Push subscription saved successfully.", data: saved });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async unsubscribePush(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { endpoint } = req.body;

      if (endpoint) {
        await PushService.removeSubscription(endpoint);
      }
      await PushService.removeUserSubscriptions(userId);

      res.json({ success: true, message: "Unsubscribed successfully." });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  async sendTestPush(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      });

      const frontendUrl = "https://community-connect-frontend-5oe1-beta.vercel.app";
      const targetUrl = `${frontendUrl.replace(/\/$/, "")}/notifications`;

      const result = await PushService.sendPushToUser(userId, {
        title: "CommunityConnect",
        body: `Hello ${user?.name || 'there'}! Native system notifications are working on this device.`,
        icon: "/icons/icon-192x192.png",
        badge: "/icons/badge-72x72.png",
        url: targetUrl,
        tag: "test-notification",
        actions: [
          { action: "open", title: "Open App" }
        ],
      });

      res.json({
        success: true,
        message: result.successful > 0
          ? `Push notification sent successfully to ${result.successful} device(s).`
          : "No active push subscriptions found. Please enable system push notifications first.",
        result,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
};
