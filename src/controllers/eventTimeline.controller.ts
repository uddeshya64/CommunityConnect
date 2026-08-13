import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { TimelineSchema, BaseTimelineSchema } from '../validation/event.validation';

const prisma = new PrismaClient();

export const EventTimelineController = {
  // GET /api/events/:eventId/timelines
  async getByEvent(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: "Invalid event ID" });
      }

      const timelines = await prisma.eventTimeline.findMany({
        where: { event_id: eventId },
        orderBy: { start_time: 'asc' }
      });

      res.json({ success: true, data: timelines });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },

  // POST /api/events/:eventId/timelines
  async create(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      if (isNaN(eventId)) {
        return res.status(400).json({ error: "Invalid event ID" });
      }

      // Validate body
      const validatedData = TimelineSchema.parse(req.body);

      const timeline = await prisma.eventTimeline.create({
        data: {
          event_id: eventId,
          title: validatedData.title,
          speaker_name: validatedData.speaker_name,
          description: validatedData.description,
          tags: validatedData.tags || [],
          start_time: validatedData.start_time,
          end_time: validatedData.end_time,
          location: validatedData.location,
          should_notify: validatedData.should_notify,
        }
      });

      res.status(201).json({ success: true, data: timeline });
    } catch (error: any) {
      if (error.issues) return res.status(400).json({ error: error.issues });
      res.status(500).json({ error: error.message });
    }
  },

  // PUT /api/events/:eventId/timelines/:timelineId
  async update(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const timelineId = Number(req.params.timelineId);

      if (isNaN(eventId) || isNaN(timelineId)) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      // Check if timeline item belongs to event
      const existing = await prisma.eventTimeline.findUnique({
        where: { id: timelineId }
      });

      if (!existing || existing.event_id !== eventId) {
        return res.status(404).json({ error: "Timeline item not found in this event" });
      }

      // Validate partial schema
      const validatedData = BaseTimelineSchema.partial().refine(
        (data) => {
          if (data.start_time && data.end_time) {
            return data.start_time < data.end_time;
          }
          return true;
        },
        {
          message: "End time must be after start time",
          path: ["end_time"],
        }
      ).parse(req.body);

      const updated = await prisma.eventTimeline.update({
        where: { id: timelineId },
        data: {
          title: validatedData.title,
          speaker_name: validatedData.speaker_name,
          description: validatedData.description,
          tags: validatedData.tags !== undefined ? validatedData.tags : undefined,
          start_time: validatedData.start_time,
          end_time: validatedData.end_time,
          location: validatedData.location,
          should_notify: validatedData.should_notify,
        }
      });

      res.json({ success: true, data: updated });
    } catch (error: any) {
      if (error.issues) return res.status(400).json({ error: error.issues });
      res.status(500).json({ error: error.message });
    }
  },

  // DELETE /api/events/:eventId/timelines/:timelineId
  async delete(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const timelineId = Number(req.params.timelineId);

      if (isNaN(eventId) || isNaN(timelineId)) {
        return res.status(400).json({ error: "Invalid parameters" });
      }

      // Check if timeline item belongs to event
      const existing = await prisma.eventTimeline.findUnique({
        where: { id: timelineId }
      });

      if (!existing || existing.event_id !== eventId) {
        return res.status(404).json({ error: "Timeline item not found in this event" });
      }

      await prisma.eventTimeline.delete({
        where: { id: timelineId }
      });

      res.json({ success: true, message: "Timeline item deleted successfully" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  }
};
