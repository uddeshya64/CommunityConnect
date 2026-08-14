import { Request, Response } from 'express';
import { EventService } from '../services/event.service';
import { CreateEventSchema, UpdateEventSchema } from '../validation/event.validation';

export const EventController = {

  // GET /api/events/types
  async getTypes(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const types = await EventService.getEventTypes(userId);
      res.json({ success: true, data: types });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
  
  // GET /api/events
  async getFeed(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const search = req.query.search as string;
      const userId = req.user?.id;

      const result = await EventService.getAllEvents(page, limit, search, userId);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    } 
  },

  // GET /api/events/:id
  async getOne(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.id);
      if (isNaN(eventId)) return res.status(400).json({ error: "Invalid event ID" });
      // If user is logged in, pass ID to get context. If not, undefined.
      const userId = req.user?.id; 

      const event = await EventService.getEventWithContext(eventId, userId);
      res.json({ success: true, data: event });
    } catch (error: any) {
      res.status(404).json({ error: error.message });
    }
  },

  // POST /api/events
  async create(req: Request, res: Response) {
    try {
      // 1. Validate Input
      const validatedData = CreateEventSchema.parse(req.body);
      const userId = req.user!.id; // Auth Middleware ensures this exists

      const event = await EventService.createEvent(userId, validatedData);
      res.status(201).json({ success: true, data: event });
    } catch (error: any) {
      if (error.issues) return res.status(400).json({ error: error.issues }); // Zod Error
      res.status(500).json({ error: error.message });
    }
  },

  // PATCH /api/events/:id
  async update(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.id);
      if (isNaN(eventId)) return res.status(400).json({ error: "Invalid event ID" });
      const userId = req.user!.id;
      const validatedData = UpdateEventSchema.parse(req.body);

      const updatedEvent = await EventService.updateEvent(eventId, userId, validatedData);
      res.json({ success: true, message: "Event updated", data: updatedEvent });
    } catch (error: any) {
      res.status(400).json({ error: error.message || error.issues });
    }
  },

  // DELETE /api/events/:id
  async delete(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.id);
      if (isNaN(eventId)) return res.status(400).json({ error: "Invalid event ID" });
      const userId = req.user!.id;

      await EventService.deleteEvent(eventId, userId);
      res.json({ success: true, message: "Event deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // POST /api/events/:id/save
  async save(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.id);
      if (isNaN(eventId)) return res.status(400).json({ error: "Invalid event ID" });
      const userId = req.user!.id;
      await EventService.saveEvent(eventId, userId);
      res.json({ success: true, message: "Event saved" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // DELETE /api/events/:id/save
  async unsave(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.id);
      if (isNaN(eventId)) return res.status(400).json({ error: "Invalid event ID" });
      const userId = req.user!.id;
      await EventService.unsaveEvent(eventId, userId);
      res.json({ success: true, message: "Event unsaved" });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // GET /api/events/saved
  async getSaved(req: Request, res: Response) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const userId = req.user!.id;
      const result = await EventService.getSavedEvents(userId, page, limit);
      res.json({ success: true, data: result });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/events/:eventId/banner
async uploadBanner(req: Request, res: Response) {
  try {
    const eventId = Number(req.params.eventId);

    if (isNaN(eventId)) {
      return res.status(400).json({
        error: "Invalid event ID",
      });
    }

    const userId = req.user!.id;

    if (!req.file) {
      return res.status(400).json({
        error: "Banner image is required",
      });
    }

    const updatedEvent = await EventService.uploadBanner(
      eventId,
      userId,
      req.file
    );

    res.status(200).json({
      success: true,
      message: "Event banner uploaded successfully",
      data: updatedEvent,
    });

  } catch (error: any) {
    res.status(400).json({
      error: error.message,
    });
  }
}
};