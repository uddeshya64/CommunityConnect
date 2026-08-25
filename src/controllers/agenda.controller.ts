import { Request, Response } from 'express';
import { RecommendationService } from '../services/recommendation.service';
import { CalendarSyncService } from '../services/calendarSync.service';
import { AgendaStatus, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const AgendaController = {
  /**
   * GET /api/agenda - Get authenticated user's recommended personal agenda
   */
  async getUserAgenda(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const agendas = await RecommendationService.getUserAgenda(userId);

      // Enhance with Google Calendar quick links
      const enhancedAgendas = agendas.map((agenda: any) => ({
        ...agenda,
        googleCalendarLink: CalendarSyncService.generateGoogleCalendarLink(
          agenda.timeline.title,
          agenda.event.title,
          agenda.timeline.description || '',
          agenda.timeline.start_time,
          agenda.timeline.end_time,
          agenda.timeline.location || agenda.event.location
        )
      }));

      // Query database user_settings directly to check if Google Calendar is connected
      const userDb = await prisma.user.findUnique({
        where: { id: userId },
        select: { user_settings: true }
      });
      const userSettings = (userDb?.user_settings as any) || {};
      const isCalendarConnected = userSettings.calendar_sync_enabled === true && !!userSettings.google_access_token;

      res.json({
        success: true,
        isCalendarConnected,
        data: enhancedAgendas
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  /**
   * POST /api/agenda/generate/:eventId - Generate/Regenerate ML recommendations for an event
   */
  async generateAgenda(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const eventId = Number(req.params.eventId);

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (isNaN(eventId)) {
        return res.status(400).json({ error: 'Invalid event ID' });
      }

      const agendaRecommendations = await RecommendationService.generatePersonalAgenda(userId, eventId);

      // Query database user_settings directly to check if Google Calendar is connected
      const userDb = await prisma.user.findUnique({
        where: { id: userId },
        select: { user_settings: true }
      });
      const userSettings = (userDb?.user_settings as any) || {};
      const isCalendarConnected = userSettings.calendar_sync_enabled === true && !!userSettings.google_access_token;

      res.json({
        success: true,
        isCalendarConnected,
        message: 'Personal agenda recommendations generated successfully',
        data: agendaRecommendations
      });
    } catch (error: any) {
      console.error('[AGENDA_GENERATE_ERROR]', error);
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  },

  /**
   * PATCH /api/agenda/:agendaId/status - Accept or Decline an agenda recommendation
   */
  async updateStatus(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const agendaId = Number(req.params.agendaId);
      const { status } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (isNaN(agendaId)) {
        return res.status(400).json({ error: 'Invalid agenda ID' });
      }

      if (!['ACCEPTED', 'DECLINED', 'RECOMMENDED'].includes(status)) {
        return res.status(400).json({ error: 'Invalid agenda status' });
      }

      const updated = await RecommendationService.updateAgendaStatus(userId, agendaId, status as AgendaStatus);

      res.json({ success: true, data: updated });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  /**
   * GET /api/agenda/export/ics - Export personal agenda to standard .ics iCalendar file
   */
  async exportICS(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const icsContent = await CalendarSyncService.generateICSFeed(userId);

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="communityconnect-agenda.ics"');
      res.send(icsContent);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  /**
   * POST /api/agenda/custom-busy-slot - Add a personal busy slot (Doctor appointment, work meeting)
   */
  async addCustomBusySlot(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { title, start_time, end_time, location } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (!title || !start_time || !end_time) {
        return res.status(400).json({ error: 'Missing title, start_time, or end_time' });
      }

      const updatedUser = await CalendarSyncService.addCustomBusySlot(userId, title, start_time, end_time, location);

      res.json({
        success: true,
        message: 'Personal busy slot added successfully for 2-way conflict checking',
        data: updatedUser.user_settings
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  /**
   * POST /api/agenda/connect-google - Save Google Access Token for 2-way Google Calendar import
   */
  async connectGoogleCalendar(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.id;
      const { access_token, refresh_token } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      if (!access_token) {
        return res.status(400).json({ error: 'Missing access_token' });
      }

      await CalendarSyncService.saveGoogleCalendarToken(userId, access_token, refresh_token);

      res.json({
        success: true,
        message: 'Google Calendar connected successfully for 2-way sync!'
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
};
