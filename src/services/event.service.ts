import { PrismaClient, Prisma } from '@prisma/client';
import { EVENT_PERMISSIONS } from '../utils/constants/permissions';



import supabase from "../config/supabase";

const prisma = new PrismaClient();

export class EventService {

  // Post event Banner

  static async uploadBanner(
  eventId: number,
  userId: number,
  file: Express.Multer.File
) {
    // Check if event exists
    const event = await prisma.event.findUnique({
      where: {
        id: eventId,
      },
    });

    if (!event) {
      throw new Error("Event not found");
    }

    // Check event ownership
    if (event.created_by !== Number(userId)) {
      throw new Error(
        "You are not authorized to update this event"
      );
    }

    // Create unique file name
    const fileName =
      `event-banners/${eventId}-${Date.now()}-${file.originalname}`;

    // Upload image to Supabase
    const { error: uploadError } =
      await supabase.storage
        .from("image-bucket")
        .upload(
          fileName,
          file.buffer,
          {
            contentType: file.mimetype,
            upsert: false,
          }
        );

    if (uploadError) {
      throw new Error(
        `Failed to upload banner image: ${uploadError.message}`
      );
    }

    // Get public URL
    const { data: publicUrlData } =
      supabase.storage
        .from("image-bucket")
        .getPublicUrl(fileName);

    const bannerURL =
      publicUrlData.publicUrl;

    // Save URL in Event.banner_url
    const updatedEvent =
      await prisma.event.update({
        where: {
          id: eventId,
        },
        data: {
          banner_url: bannerURL,
        },
        select: {
          id: true,
          title: true,
          banner_url: true,
        },
      });

    return updatedEvent;
  }

  // 1. POST EVENT
  static async createEvent(userId: number, data: any) {
    return prisma.$transaction(async (tx) => {
      const {
        title, description, type, mode, banner_url, logo_url,
        start_date, end_date, registration_type, registration_fee,
        max_team_size, min_team_size, capacity, location, rewards,
         custom_fields, custom_form_schema,  // NEW: template-specific fields (speakers, prizes, RSVP deadline, etc.)
      } = data;

      // Find or create the event type (case-insensitive)
      let eventType = await tx.eventType.findFirst({
        where: {
          name: {
            equals: type,
            mode: 'insensitive'
          }
        }
      });

      if (!eventType) {
        eventType = await tx.eventType.create({
          data: {
            name: type,
            is_system: false,
            created_by: userId
          }
        });
      }

      const newEvent = await tx.event.create({
        data: {
          title, description,
          type_id: eventType.id,
          mode,
          banner_url: banner_url ?? undefined,
          logo_url: logo_url ?? undefined,
          start_date: start_date instanceof Date ? start_date : new Date(start_date),
          end_date: end_date instanceof Date ? end_date : new Date(end_date),
          registration_type,
          registration_fee: registration_fee ?? 0,
          max_team_size, min_team_size,
          capacity: capacity ?? 0,
          location: location ?? undefined,
          rewards: rewards ?? undefined,
          custom_fields: custom_fields ?? undefined, // NEW
          custom_form_schema: custom_form_schema ?? undefined,
          created_by: userId,
        }
      });

      await tx.eventRoleDefinition.createMany({
        data: [
          {
            event_id: newEvent.id,
            name: "Admin",
            permissions: [
              EVENT_PERMISSIONS.MANAGE_EVENT,
              EVENT_PERMISSIONS.MANAGE_STAFF,
              EVENT_PERMISSIONS.VIEW_DASHBOARD,
              EVENT_PERMISSIONS.MANAGE_ATTENDEES,
              EVENT_PERMISSIONS.MANAGE_FORMS,
              EVENT_PERMISSIONS.MANAGE_TICKETS,
              EVENT_PERMISSIONS.MANAGE_CHECK_IN,
              EVENT_PERMISSIONS.MANAGE_AGENDA,
              EVENT_PERMISSIONS.MANAGE_SPEAKERS,
              EVENT_PERMISSIONS.SCORE_SUBMISSIONS,
              EVENT_PERMISSIONS.MANAGE_COMMUNICATIONS
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Registration Manager",
            permissions: [
              EVENT_PERMISSIONS.MANAGE_FORMS,
              EVENT_PERMISSIONS.MANAGE_TICKETS,
              EVENT_PERMISSIONS.MANAGE_INVITATIONS,
              EVENT_PERMISSIONS.MANAGE_CHECK_IN,
              EVENT_PERMISSIONS.MANAGE_REFUNDS,
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Program Manager",
            permissions: [
              EVENT_PERMISSIONS.MANAGE_AGENDA,
              EVENT_PERMISSIONS.MANAGE_TRACKS,
              EVENT_PERMISSIONS.MANAGE_SESSIONS,
              EVENT_PERMISSIONS.MANAGE_SPEAKERS,
              EVENT_PERMISSIONS.MANAGE_CONTENT,
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Volunteer",
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD,
              EVENT_PERMISSIONS.MANAGE_ATTENDEES,
              EVENT_PERMISSIONS.VIEW_SHIFTS,
              EVENT_PERMISSIONS.MANAGE_ASSIGNED_TASKS,
              EVENT_PERMISSIONS.ACKNOWLEDGE_TASKS,
              EVENT_PERMISSIONS.MANAGE_CHECK_IN
            ],
            is_system: true
          },
          {
            event_id: newEvent.id,
            name: "Guest",
            permissions: [
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ],
            is_system: true
          }
        ]
      });

      // Automatically assign the event creator the Admin role
      const adminRoleDef = await tx.eventRoleDefinition.findFirst({
        where: { event_id: newEvent.id, name: "Admin" }
      });

      if (adminRoleDef) {
        await tx.eventUserRole.create({
          data: {
            event_id: newEvent.id,
            user_id: userId,
            role_id: adminRoleDef.id,
            permissions_override: []
          }
        });
      }

      return {
        ...newEvent,
        type
      };
    });
  }

  // 2. GET ALL EVENTS
  static async getAllEvents(page = 1, limit = 10, search?: string, userId?: number) {
    const skip = (page - 1) * limit;

    const whereClause: Prisma.EventWhereInput = search ? {
      OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { timelines: { some: { tags: { has: search } } } },
      ]
    } : {};

    const events = await prisma.event.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: { start_date: 'asc' },
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } },
        type: { select: { name: true } },
        timelines: { select: { tags: true } }
      }
    });

    const total = await prisma.event.count({ where: whereClause });

    let savedEventIds = new Set<number>();
    if (userId) {
      const saved = await prisma.savedEvent.findMany({
        where: { user_id: userId },
        select: { event_id: true }
      });
      savedEventIds = new Set(saved.map(s => s.event_id));
    }

    // Map response to keep type as string and aggregate tags
    const formattedEvents = events.map(evt => {
      const { type, timelines, ...rest } = evt;
      const aggregatedTags = Array.from(
        new Set((timelines || []).flatMap(t => t.tags || []))
      );

      return {
        ...rest,
        type: type.name,
        tags: aggregatedTags,
        is_saved: savedEventIds.has(evt.id)
      };
    });

    return { events: formattedEvents, total, totalPages: Math.ceil(total / limit) };
  }

  // 3. GET ONE EVENT WITH CONTEXT (UPDATED FOR UNIFIED CONTEXT)
  static async getEventWithContext(eventId: number, userId?: number) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        creator: { select: { id: true, name: true, avatar_url: true } },
        type: { select: { name: true } },
        user_roles: {
          include: {
            user: { select: { id: true, name: true, email: true, avatar_url: true } },
            role: { select: { name: true, permissions: true } }
          }
        },
        role_definitions: { select: { id: true, name: true, permissions: true } },
        _count: { select: { registrations: true } },
        timelines: { orderBy: { start_time: 'asc' } }
      }
    });

    if (!event) throw new Error("Event not found");

    // Unified User Context Object
    let userContext = {
      is_organizer: false,
      role: null as string | null,
      permissions: [] as string[],
      is_registered: false,
      registration_status: null as string | null,
      team_id: null as number | null,
      team_name: null as string | null,
      registration_id: null as number | null,
      is_saved: false
    };

    if (userId) {
      if (event.created_by === userId) {
        userContext.is_organizer = true;
        userContext.role = "Admin";
        userContext.permissions = Object.values(EVENT_PERMISSIONS);
      }

      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true }
      });

      if (staffRole) {
        userContext.role = staffRole.role.name;
        const userOverrides = staffRole.permissions_override as string[] | null;
        const effectivePermissions = Array.isArray(userOverrides)
          ? userOverrides
          : ((staffRole.role.permissions as string[]) || []);
        userContext.permissions = effectivePermissions;
      }

      // 👇 NEW: Fetch registration details including team info
      const reg = await prisma.registration.findFirst({
        where: { event_id: eventId, user_id: userId },
        include: { team: { select: { name: true } } }
      });

      if (reg) {
        userContext.is_registered = reg.status === 'confirmed';
        userContext.registration_status = reg.status; // e.g., 'pending', 'confirmed'
        userContext.team_id = reg.team_id;
        userContext.team_name = reg.team?.name || null;
        userContext.registration_id = reg.id;
      }

      const saved = await prisma.savedEvent.findUnique({
        where: { user_id_event_id: { user_id: userId, event_id: eventId } }
      });
      if (saved) {
        userContext.is_saved = true;
      }
    }

    const { type, ...rest } = event;
    const aggregatedTags = Array.from(
      new Set((event.timelines || []).flatMap((t) => t.tags || []))
    );
    return { ...rest, type: type.name, tags: aggregatedTags, user_context: userContext };
  }

  // 4. UPDATE EVENT
  static async updateEvent(eventId: number, userId: number, data: any) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    const isCreator = event.created_by === userId;

    if (!isCreator) {
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true }
      });

      if (!staffRole) throw new Error("Unauthorized: You are not staff for this event");

      const rolePermissions = (staffRole.role.permissions as string[]) || [];
      const overrides = (staffRole.permissions_override as string[]) || [];

      const hasManagePermission =
        rolePermissions.includes(EVENT_PERMISSIONS.MANAGE_EVENT) ||
        overrides.includes(EVENT_PERMISSIONS.MANAGE_EVENT);

      if (!hasManagePermission) throw new Error("Unauthorized: You lack the MANAGE_EVENT permission");
    }

    const { type, ...updateData } = data;
    const finalUpdateData: any = { ...updateData };

    // NOTE: custom_fields is passed through automatically via ...updateData above
    // since it is now part of UpdateEventSchema. No extra handling needed here.

    if (type) {
      // Find or create the event type (case-insensitive)
      let eventType = await prisma.eventType.findFirst({
        where: {
          name: {
            equals: type,
            mode: 'insensitive'
          }
        }
      });

      if (!eventType) {
        eventType = await prisma.eventType.create({
          data: {
            name: type,
            is_system: false,
            created_by: userId
          }
        });
      }
      finalUpdateData.type_id = eventType.id;
    }

    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: finalUpdateData,
      include: {
        type: { select: { name: true } }
      }
    });

    const { type: updatedType, ...rest } = updatedEvent;
    return { ...rest, type: updatedType.name };
  }

  // 5. DELETE EVENT
  static async deleteEvent(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");
    if (event.created_by !== userId) throw new Error("Only the creator can delete an event");

    return prisma.event.delete({ where: { id: eventId } });
  }

  // 6. GET ALL EVENT TYPES
  static async getEventTypes(userId?: number) {
    return prisma.eventType.findMany({
      where: {
        OR: [
          { is_system: true },
          ...(userId ? [{ created_by: userId }] : [])
        ]
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        is_system: true
      }
    });
  }

  // 7. SAVE EVENT
  static async saveEvent(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    return prisma.savedEvent.upsert({
      where: { user_id_event_id: { user_id: userId, event_id: eventId } },
      create: { user_id: userId, event_id: eventId },
      update: {}
    });
  }

  // 8. UNSAVE EVENT
  static async unsaveEvent(eventId: number, userId: number) {
    try {
      await prisma.savedEvent.delete({
        where: { user_id_event_id: { user_id: userId, event_id: eventId } }
      });
    } catch (error) {
      // Ignore if not found
    }
    return { success: true };
  }

  // 9. GET SAVED EVENTS
  static async getSavedEvents(userId: number, page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const savedEvents = await prisma.savedEvent.findMany({
      where: { user_id: userId },
      skip,
      take: limit,
      orderBy: { saved_at: 'desc' },
      include: {
        event: {
          include: {
            creator: { select: { id: true, name: true, avatar_url: true } },
            type: { select: { name: true } }
          }
        }
      }
    });

    const total = await prisma.savedEvent.count({ where: { user_id: userId } });

    const formattedEvents = savedEvents.map(se => {
      const { type, ...rest } = se.event;
      return {
        ...rest,
        type: type.name,
        is_saved: true,
        saved_at: se.saved_at
      };
    });

    return { events: formattedEvents, total, totalPages: Math.ceil(total / limit) };
  }
}