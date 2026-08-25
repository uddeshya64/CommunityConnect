import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

/**
 * Format JavaScript Date into UTC iCalendar format (YYYYMMDDTHHMMSSZ)
 */
function formatICalDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

export interface ExternalCalendarEvent {
  id: string;
  summary: string;
  start: Date;
  end: Date;
  location?: string;
  isExternal: boolean;
}

export class CalendarSyncService {
  /**
   * Fetch external Google Calendar events for a user between start and end time (Two-Way Import)
   * ONLY queries Google Calendar API if user explicitly enabled calendar sync permissions!
   */
  static async fetchExternalGoogleCalendarEvents(
    userId: number,
    timeMin: Date,
    timeMax: Date
  ): Promise<ExternalCalendarEvent[]> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { user_settings: true, email: true }
      });

      const userSettings = (user?.user_settings as any) || {};
      const googleAccessToken = userSettings.google_access_token;
      const calendarSyncEnabled = userSettings.calendar_sync_enabled === true;

      // ONLY query Google Calendar API if user explicitly clicked "Connect Google Calendar" & granted permission
      if (calendarSyncEnabled && googleAccessToken) {
        try {
          const response = await axios.get(
            'https://www.googleapis.com/calendar/v3/calendars/primary/events',
            {
              headers: {
                Authorization: `Bearer ${googleAccessToken}`
              },
              params: {
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                singleEvents: true,
                orderBy: 'startTime'
              }
            }
          );

          const googleEvents = response.data.items || [];
          return googleEvents.map((item: any) => ({
            id: item.id,
            summary: item.summary || 'Personal Event',
            start: new Date(item.start.dateTime || item.start.date),
            end: new Date(item.end.dateTime || item.end.date),
            location: item.location,
            isExternal: true
          }));
        } catch (err: any) {
          console.warn('[CALENDAR_SYNC_WARN] Google Calendar API request failed:', err.response?.data || err.message);
        }
      }

      // If token not set or sync not enabled, check custom busy slots in user_settings
      const customBusySlots = userSettings.busy_slots || [];
      return customBusySlots.map((slot: any, idx: number) => ({
        id: `custom-slot-${idx}`,
        summary: slot.title || 'Personal Event / Meeting',
        start: new Date(slot.start_time),
        end: new Date(slot.end_time),
        location: slot.location || 'Personal Calendar',
        isExternal: true
      }));
    } catch (error) {
      console.error('[CALENDAR_IMPORT_ERROR] Failed to fetch Google Calendar events:', error);
      return [];
    }
  }

  /**
   * Save user Google OAuth Access Token for Two-Way Calendar Syncing
   */
  static async saveGoogleCalendarToken(userId: number, accessToken: string, refreshToken?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const existingSettings = (user?.user_settings as any) || {};

    return prisma.user.update({
      where: { id: userId },
      data: {
        user_settings: {
          ...existingSettings,
          google_access_token: accessToken,
          ...(refreshToken && { google_refresh_token: refreshToken }),
          calendar_sync_enabled: true
        }
      }
    });
  }

  /**
   * Add custom busy slot to personal calendar (e.g. Doctor appointment, personal work)
   */
  static async addCustomBusySlot(userId: number, title: string, startTime: string, endTime: string, location?: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const existingSettings = (user?.user_settings as any) || {};
    const busySlots = existingSettings.busy_slots || [];

    const newSlot = {
      id: `slot_${Date.now()}`,
      title,
      start_time: startTime,
      end_time: endTime,
      location: location || 'Personal Calendar'
    };

    return prisma.user.update({
      where: { id: userId },
      data: {
        user_settings: {
          ...existingSettings,
          busy_slots: [...busySlots, newSlot]
        }
      }
    });
  }

  /**
   * Generates standard RFC 5545 iCalendar (.ics) string for user's personal agenda
   */
  static async generateICSFeed(userId: number): Promise<string> {
    const agendas = await prisma.userAgenda.findMany({
      where: {
        user_id: userId,
        status: { in: ['ACCEPTED', 'RECOMMENDED'] }
      },
      include: {
        timeline: true,
        event: true
      },
      orderBy: {
        timeline: {
          start_time: 'asc'
        }
      }
    });

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CommunityConnect//Personal Agenda//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:CommunityConnect Personal Agenda'
    ];

    for (const agenda of agendas) {
      const timeline = agenda.timeline;
      const event = agenda.event;

      const startTime = formatICalDate(new Date(timeline.start_time));
      const endTime = timeline.end_time
        ? formatICalDate(new Date(timeline.end_time))
        : formatICalDate(new Date(new Date(timeline.start_time).getTime() + 3600000));

      const summary = `[${event.title}] ${timeline.title}`;
      const description = [
        timeline.description || '',
        timeline.speaker_name ? `Speaker: ${timeline.speaker_name}` : '',
        `Match Score: ${Math.round(agenda.match_score * 100)}%`
      ].filter(Boolean).join('\\n');

      lines.push(
        'BEGIN:VEVENT',
        `UID:agenda-${agenda.id}-${timeline.id}@communityconnect.app`,
        `DTSTAMP:${formatICalDate(new Date())}`,
        `DTSTART:${startTime}`,
        `DTEND:${endTime}`,
        `SUMMARY:${summary.replace(/\n/g, ' ')}`,
        `DESCRIPTION:${description}`,
        `LOCATION:${(timeline.location || event.location || 'Online').replace(/\n/g, ' ')}`,
        'STATUS:CONFIRMED',
        'END:VEVENT'
      );
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  /**
   * Generate direct Google Calendar web add link for a specific session
   */
  static generateGoogleCalendarLink(sessionTitle: string, eventTitle: string, description: string, startTime: Date, endTime?: Date | null, location?: string | null): string {
    const startStr = formatICalDate(new Date(startTime));
    const endStr = endTime 
      ? formatICalDate(new Date(endTime))
      : formatICalDate(new Date(new Date(startTime).getTime() + 3600000));

    const details = encodeURIComponent(`${description}\n\nOrganized by CommunityConnect (${eventTitle})`);
    const title = encodeURIComponent(`${sessionTitle} - ${eventTitle}`);
    const loc = encodeURIComponent(location || 'Online Session');

    return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startStr}/${endStr}&details=${details}&location=${loc}`;
  }
}
