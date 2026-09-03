import { PrismaClient } from '@prisma/client';
import { PushService } from './push.service';

const prisma = new PrismaClient();

export const AnnouncementService = {
  // 1. BROADCAST ANNOUNCEMENT TO PARTICIPANTS & STAFF
  async createAnnouncement(eventId: number, authorId: number, data: {
    title?: string;
    message: string;
    targetGroup?: string;
  }) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, created_by: true }
    });
    if (!event) throw new Error("Event not found.");

    const author = await prisma.user.findUnique({
      where: { id: authorId },
      select: { id: true, name: true }
    });

    const targetGroup = data.targetGroup || 'all';

    const announcement = await (prisma as any).eventAnnouncement.create({
      data: {
        event_id: eventId,
        author_id: authorId,
        title: data.title || `Announcement for ${event.title}`,
        message: data.message,
        target_group: targetGroup
      },
      include: {
        author: { select: { id: true, name: true, email: true, avatar_url: true } },
        reactions: true
      }
    });

    // Determine target users for push notification
    let recipientUserIds: number[] = [];

    if (targetGroup === 'all' || targetGroup === 'participants') {
      const registrations = await prisma.registration.findMany({
        where: { event_id: eventId, status: 'confirmed' },
        select: { user_id: true }
      });
      recipientUserIds.push(...registrations.map(r => r.user_id));
    }

    if (targetGroup === 'all' || targetGroup === 'staff') {
      const staffRoles = await prisma.eventUserRole.findMany({
        where: { event_id: eventId },
        select: { user_id: true }
      });
      recipientUserIds.push(...staffRoles.map(s => s.user_id));
    }

    recipientUserIds.push(event.created_by);
    const uniqueUserIds = Array.from(new Set(recipientUserIds)).filter(id => id !== authorId);

    // Broadcast push notification to all target users
    const pushTitle = `📢 ${event.title}: ${announcement.title}`;
    const pushBody = data.message.length > 100 ? `${data.message.slice(0, 97)}...` : data.message;

    Promise.all(
      uniqueUserIds.map(uid =>
        PushService.sendPushToUser(uid, {
          title: pushTitle,
          body: pushBody,
          url: `/events/${eventId}`,
          tag: `announcement-${announcement.id}`
        }).catch(err => console.error(`Error sending push to user ${uid}:`, err))
      )
    ).catch(console.error);

    return announcement;
  },

  // 2. GET ALL ANNOUNCEMENTS FOR AN EVENT WITH REACTION COUNTS & USER REACTION STATE
  async getAnnouncements(eventId: number, currentUserId?: number) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { created_by: true }
    });

    let isCreatorOrAdmin = false;
    let isStaff = false;
    let isParticipant = false;

    if (currentUserId) {
      if (event?.created_by === currentUserId) {
        isCreatorOrAdmin = true;
      }

      const [staffRole, reg] = await Promise.all([
        prisma.eventUserRole.findUnique({
          where: { event_id_user_id: { event_id: eventId, user_id: currentUserId } },
          include: { role: true }
        }),
        prisma.registration.findFirst({
          where: { event_id: eventId, user_id: currentUserId, status: 'confirmed' }
        })
      ]);

      if (staffRole) {
        isStaff = true;
        const userOverrides = staffRole.permissions_override as string[] | null;
        const effectivePermissions = Array.isArray(userOverrides)
          ? userOverrides
          : ((staffRole.role?.permissions as string[]) || []);
        if (staffRole.role.name === 'Admin' || effectivePermissions.includes('MANAGE_COMMUNICATIONS') || effectivePermissions.includes('MANAGE_EVENT')) {
          isCreatorOrAdmin = true;
        }
      }

      if (reg) {
        isParticipant = true;
      }
    }

    const announcements = await (prisma as any).eventAnnouncement.findMany({
      where: { event_id: eventId },
      include: {
        author: { select: { id: true, name: true, email: true, avatar_url: true } },
        reactions: {
          include: {
            user: { select: { id: true, name: true } }
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    // FILTER BASED ON TARGET GROUP AND USER ROLE SCOPE
    const filteredAnnouncements = announcements.filter((ann: any) => {
      // Admins, Event Creator, and Author see all announcements
      if (isCreatorOrAdmin || (currentUserId && ann.author_id === currentUserId)) {
        return true;
      }

      // 'all' announcements are visible to everyone
      if (ann.target_group === 'all') {
        return true;
      }

      // 'staff' announcements are visible ONLY to staff members
      if (ann.target_group === 'staff') {
        return isStaff;
      }

      // 'participants' announcements are visible ONLY to registered participants
      if (ann.target_group === 'participants') {
        return isParticipant;
      }

      return true;
    });

    return filteredAnnouncements.map((ann: any) => {
      const reactionMap: Record<string, { count: number; users: string[]; hasReacted: boolean }> = {};

      (ann.reactions || []).forEach((r: any) => {
        if (!reactionMap[r.emoji]) {
          reactionMap[r.emoji] = { count: 0, users: [], hasReacted: false };
        }
        reactionMap[r.emoji].count += 1;
        if (r.user?.name) reactionMap[r.emoji].users.push(r.user.name);
        if (currentUserId && r.user_id === currentUserId) {
          reactionMap[r.emoji].hasReacted = true;
        }
      });

      return {
        id: ann.id,
        eventId: ann.event_id,
        title: ann.title,
        message: ann.message,
        targetGroup: ann.target_group,
        author: ann.author,
        createdAt: ann.created_at,
        reactionSummary: Object.entries(reactionMap).map(([emoji, data]) => ({
          emoji,
          count: data.count,
          users: data.users,
          hasReacted: data.hasReacted
        }))
      };
    });
  },

  // 3. TOGGLE EMOJI REACTION (WHATSAPP-STYLE EMOJI TOGGLE)
  async toggleReaction(eventId: number, announcementId: number, userId: number, emoji: string) {
    const announcement = await (prisma as any).eventAnnouncement.findUnique({
      where: { id: announcementId }
    });
    if (!announcement || announcement.event_id !== eventId) {
      throw new Error("Announcement not found.");
    }

    const existingReaction = await (prisma as any).announcementReaction.findUnique({
      where: {
        announcement_id_user_id_emoji: {
          announcement_id: announcementId,
          user_id: userId,
          emoji
        }
      }
    });

    if (existingReaction) {
      await (prisma as any).announcementReaction.delete({
        where: { id: existingReaction.id }
      });
    } else {
      await (prisma as any).announcementReaction.create({
        data: {
          announcement_id: announcementId,
          user_id: userId,
          emoji
        }
      });
    }

    return this.getAnnouncements(eventId, userId);
  },

  // 4. DELETE ANNOUNCEMENT
  async deleteAnnouncement(eventId: number, announcementId: number, userId: number) {
    const announcement = await (prisma as any).eventAnnouncement.findUnique({
      where: { id: announcementId },
      include: { event: { select: { created_by: true } } }
    });

    if (!announcement || announcement.event_id !== eventId) {
      throw new Error("Announcement not found.");
    }

    const isAuthor = announcement.author_id === userId;
    const isEventCreator = announcement.event.created_by === userId;

    if (!isAuthor && !isEventCreator) {
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true }
      });
      const userOverrides = staffRole?.permissions_override as string[] | null;
      const effectivePermissions = Array.isArray(userOverrides)
        ? userOverrides
        : ((staffRole?.role?.permissions as string[]) || []);

      if (!staffRole || (!effectivePermissions.includes('MANAGE_COMMUNICATIONS') && !effectivePermissions.includes('MANAGE_EVENT') && staffRole.role.name !== 'Admin')) {
        throw new Error("Unauthorized to delete this announcement.");
      }
    }

    return (prisma as any).eventAnnouncement.delete({ where: { id: announcementId } });
  }
};
