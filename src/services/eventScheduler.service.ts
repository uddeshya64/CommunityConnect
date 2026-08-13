import { PrismaClient } from '@prisma/client';
import { PushService } from './push.service';

const prisma = new PrismaClient();

export class EventSchedulerService {
  private static intervalId: NodeJS.Timeout | null = null;

  // Initialize background scheduler
  static startScheduler(intervalMs = 60 * 1000) { // Runs every 1 minute
    if (this.intervalId) return;

    console.log('⏰ [SCHEDULER] Event Notification Scheduler started.');

    // Run once immediately on server boot
    this.runChecks().catch((err) => console.error('[SCHEDULER_ERROR]', err));

    this.intervalId = setInterval(() => {
      this.runChecks().catch((err) => console.error('[SCHEDULER_ERROR]', err));
    }, intervalMs);
  }

  static stopScheduler() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('⏰ [SCHEDULER] Event Notification Scheduler stopped.');
    }
  }

  // Master check routine
  static async runChecks() {
    await this.check24HourEventReminders();
    await this.checkTimelineSessionReminders();
  }

  // ============================================================
  // 1. 24-HOUR PRE-EVENT REMINDERS
  // ============================================================
  private static async check24HourEventReminders() {
    try {
      const now = new Date();
      const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      const in25Hours = new Date(now.getTime() + 25 * 60 * 60 * 1000);

      // Find events starting between 24 and 25 hours from now
      const upcomingEvents = await prisma.event.findMany({
        where: {
          start_date: {
            gte: in24Hours,
            lte: in25Hours,
          },
        },
        include: {
          registrations: {
            where: { status: 'confirmed' },
            select: { user_id: true },
          },
        },
      });

      for (const event of upcomingEvents) {
        // Check if 24h reminder was already dispatched using custom_fields
        const customFields = (event.custom_fields as Record<string, any>) || {};
        if (customFields.reminder_24h_sent) {
          continue;
        }

        const formattedTime = new Date(event.start_date).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        });

        const locationText = event.mode === 'online'
          ? 'Online Event'
          : (event.location || 'Venue');

        console.log(`📣 [REMINDER_24H] Sending 24h reminder for "${event.title}" to ${event.registrations.length} attendees.`);

        for (const reg of event.registrations) {
          await PushService.sendPushToUser(reg.user_id, {
            title: `⏳ Tomorrow: ${event.title}`,
            body: `Starts tomorrow at ${formattedTime}! Location: ${locationText}. Tap to view your entry pass.`,
            url: `/events/${event.id}`,
            tag: `event-reminder-24h-${event.id}`,
            actions: [{ action: 'open', title: 'View Event' }],
          }).catch((err) => {
            console.error(`Failed to send 24h reminder to user ${reg.user_id}:`, err.message);
          });
        }

        // Mark 24h reminder as sent in custom_fields
        await prisma.event.update({
          where: { id: event.id },
          data: {
            custom_fields: {
              ...customFields,
              reminder_24h_sent: true,
              reminder_24h_sent_at: new Date().toISOString(),
            },
          },
        });
      }
    } catch (err: any) {
      console.error('[SCHEDULER_24H_ERROR]', err.message);
    }
  }

  // ============================================================
  // 2. TIMELINE & AGENDA SESSION REMINDERS (15-30 mins prior)
  // ============================================================
  private static async checkTimelineSessionReminders() {
    try {
      const now = new Date();
      // Look for sessions starting between now and next 20 minutes
      const in20Minutes = new Date(now.getTime() + 20 * 60 * 1000);

      const upcomingTimelines = await prisma.eventTimeline.findMany({
        where: {
          should_notify: true,
          is_notified: false,
          start_time: {
            gte: now,
            lte: in20Minutes,
          },
        },
        include: {
          event: {
            include: {
              registrations: {
                where: { status: 'confirmed' },
                select: { user_id: true },
              },
            },
          },
        },
      });

      for (const timeline of upcomingTimelines) {
        const timeDiffMs = new Date(timeline.start_time).getTime() - now.getTime();
        const minsLeft = Math.max(1, Math.round(timeDiffMs / (60 * 1000)));

        const speakerText = timeline.speaker_name ? `with ${timeline.speaker_name} ` : '';
        const locationText = timeline.location ? `at ${timeline.location}` : '';

        console.log(`🎙️ [TIMELINE_REMINDER] Session "${timeline.title}" starting in ~${minsLeft} mins. Notifying ${timeline.event.registrations.length} attendees.`);

        for (const reg of timeline.event.registrations) {
          await PushService.sendPushToUser(reg.user_id, {
            title: `🗓️ Starting in ${minsLeft}m: ${timeline.title}`,
            body: `Session ${speakerText}${locationText}is starting soon in "${timeline.event.title}". Tap to view agenda.`.trim(),
            url: `/events/${timeline.event_id}`,
            tag: `timeline-session-${timeline.id}`,
            actions: [{ action: 'open', title: 'View Agenda' }],
          }).catch((err) => {
            console.error(`Failed to send timeline reminder to user ${reg.user_id}:`, err.message);
          });
        }

        // Mark as notified so it never fires duplicate alerts
        await prisma.eventTimeline.update({
          where: { id: timeline.id },
          data: { is_notified: true },
        });
      }
    } catch (err: any) {
      console.error('[SCHEDULER_TIMELINE_ERROR]', err.message);
    }
  }
}
