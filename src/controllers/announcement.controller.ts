import { Request, Response } from 'express';
import { AnnouncementService } from '../services/announcement.service';

export const AnnouncementController = {
  // 1. CREATE & BROADCAST ANNOUNCEMENT
  async createAnnouncement(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const authorId = req.user!.id;
      const { title, message, targetGroup } = req.body;

      if (!message) {
        return res.status(400).json({ error: "Announcement message is required." });
      }

      const announcement = await AnnouncementService.createAnnouncement(eventId, authorId, {
        title,
        message,
        targetGroup
      });

      res.status(201).json({
        success: true,
        message: "Announcement broadcasted successfully to all target participants and staff.",
        data: announcement
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 2. GET ANNOUNCEMENTS FOR EVENT
  async getAnnouncements(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const userId = req.user?.id;

      const announcements = await AnnouncementService.getAnnouncements(eventId, userId);

      res.json({
        success: true,
        data: announcements
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 3. TOGGLE EMOJI REACTION
  async toggleReaction(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const announcementId = Number(req.params.announcementId);
      const userId = req.user!.id;
      const { emoji } = req.body;

      if (!emoji) {
        return res.status(400).json({ error: "Emoji parameter is required." });
      }

      const updatedAnnouncements = await AnnouncementService.toggleReaction(eventId, announcementId, userId, emoji);

      res.json({
        success: true,
        message: "Reaction updated.",
        data: updatedAnnouncements
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 4. DELETE ANNOUNCEMENT
  async deleteAnnouncement(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const announcementId = Number(req.params.announcementId);
      const userId = req.user!.id;

      await AnnouncementService.deleteAnnouncement(eventId, announcementId, userId);

      res.json({
        success: true,
        message: "Announcement deleted successfully."
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
