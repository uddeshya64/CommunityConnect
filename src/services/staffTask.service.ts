import { PrismaClient } from '@prisma/client';
import { PushService } from './push.service';

const prisma = new PrismaClient();

export const StaffTaskService = {
  // 1. CREATE AND ASSIGN A TASK
  async createTask(eventId: number, creatorId: number, data: {
    title: string;
    description?: string;
    priority?: string;
    assignedToId: number;
    dueDate?: string;
  }) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, created_by: true }
    });
    if (!event) throw new Error("Event not found.");

    const creator = await prisma.user.findUnique({
      where: { id: creatorId },
      select: { id: true, name: true }
    });

    const task = await (prisma as any).eventStaffTask.create({
      data: {
        event_id: eventId,
        created_by_id: creatorId,
        assigned_to_id: data.assignedToId,
        title: data.title,
        description: data.description || null,
        priority: data.priority || 'medium',
        due_date: data.dueDate ? new Date(data.dueDate) : null
      },
      include: {
        assigned_to: { select: { id: true, name: true, email: true, avatar_url: true } },
        created_by: { select: { id: true, name: true, email: true, avatar_url: true } },
        event: { select: { id: true, title: true } }
      }
    });

    // Notify assigned member
    const creatorName = creator?.name || "An Admin";
    PushService.sendPushToUser(data.assignedToId, {
      title: `New Task Assigned in ${event.title}`,
      body: `${creatorName} assigned you a task: "${task.title}".`,
      url: `/events/${eventId}`,
      tag: `task-assigned-${task.id}`
    }).catch(console.error);

    if (task.assigned_to.email) {
      PushService.sendPushToEmail(task.assigned_to.email, {
        title: `New Task Assigned in ${event.title}`,
        body: `${creatorName} assigned you a task: "${task.title}".`,
        url: `/events/${eventId}`,
        tag: `task-assigned-${task.id}`
      }).catch(console.error);
    }

    return task;
  },

  // 2. GET TASKS (ADMINS SEE ALL TASKS, REGULAR MEMBERS SEE ONLY ASSIGNED TASKS)
  async getTasksForUser(eventId: number, userId: number) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, created_by: true }
    });
    if (!event) throw new Error("Event not found.");

    const isCreator = event.created_by === userId;

    const staffRole = await prisma.eventUserRole.findUnique({
      where: { event_id_user_id: { event_id: eventId, user_id: userId } },
      include: { role: true }
    });

    const userOverrides = staffRole?.permissions_override as string[] | null;
    const effectivePermissions = Array.isArray(userOverrides)
      ? userOverrides
      : ((staffRole?.role?.permissions as string[]) || []);

    const isAdmin = isCreator || staffRole?.role?.name === 'Admin' || effectivePermissions.includes('MANAGE_STAFF') || effectivePermissions.includes('MANAGE_EVENT');

    let whereClause: any = { event_id: eventId };
    if (!isAdmin) {
      // NON-ADMIN MEMBERS ONLY SEE THEIR ASSIGNED TASKS (OR TASKS CREATED BY THEM)
      whereClause.OR = [
        { assigned_to_id: userId },
        { created_by_id: userId }
      ];
    }

    return (prisma as any).eventStaffTask.findMany({
      where: whereClause,
      include: {
        assigned_to: { select: { id: true, name: true, email: true, avatar_url: true } },
        created_by: { select: { id: true, name: true, email: true, avatar_url: true } }
      },
      orderBy: { created_at: 'desc' }
    });
  },

  // 3. UPDATE TASK STATUS (PENDING / COMPLETED)
  async updateTaskStatus(eventId: number, taskId: number, userId: number, status: 'pending' | 'completed') {
    const task = await (prisma as any).eventStaffTask.findUnique({
      where: { id: taskId },
      include: {
        event: { select: { id: true, title: true, created_by: true } },
        assigned_to: { select: { id: true, name: true, email: true } },
        created_by: { select: { id: true, name: true, email: true } }
      }
    });

    if (!task || task.event_id !== eventId) {
      throw new Error("Task not found for this event.");
    }

    const eventCreatorId = task.event.created_by;
    const isAssignee = task.assigned_to_id === userId;
    const isTaskCreator = task.created_by_id === userId;
    const isEventCreator = eventCreatorId === userId;

    if (!isAssignee && !isTaskCreator && !isEventCreator) {
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true }
      });
      if (!staffRole || staffRole.role.name !== 'Admin') {
        throw new Error("Unauthorized to update this task.");
      }
    }

    const updatedTask = await (prisma as any).eventStaffTask.update({
      where: { id: taskId },
      data: {
        status,
        completed_at: status === 'completed' ? new Date() : null
      },
      include: {
        assigned_to: { select: { id: true, name: true, email: true, avatar_url: true } },
        created_by: { select: { id: true, name: true, email: true, avatar_url: true } }
      }
    });

    // Notify task creator & Admin when task is completed
    if (status === 'completed') {
      const userRes = await prisma.user.findUnique({
        where: { id: userId },
        select: { name: true }
      });
      const updaterName = userRes?.name || "Staff member";
      const eventTitle = task.event.title;

      if (task.created_by_id !== userId) {
        PushService.sendPushToUser(task.created_by_id, {
          title: `Task Completed in ${eventTitle}`,
          body: `${updaterName} completed the task: "${task.title}".`,
          url: `/events/${eventId}`,
          tag: `task-completed-${task.id}`
        }).catch(console.error);

        if (task.created_by.email) {
          PushService.sendPushToEmail(task.created_by.email, {
            title: `Task Completed in ${eventTitle}`,
            body: `${updaterName} completed the task: "${task.title}".`,
            url: `/events/${eventId}`,
            tag: `task-completed-${task.id}`
          }).catch(console.error);
        }
      }

      if (eventCreatorId !== userId && eventCreatorId !== task.created_by_id) {
        PushService.sendPushToUser(eventCreatorId, {
          title: `Task Completed in ${eventTitle}`,
          body: `${updaterName} completed the task: "${task.title}".`,
          url: `/events/${eventId}`,
          tag: `task-completed-${task.id}`
        }).catch(console.error);
      }
    }

    return updatedTask;
  },

  // 4. DELETE A TASK
  async deleteTask(eventId: number, taskId: number, userId: number) {
    const task = await (prisma as any).eventStaffTask.findUnique({
      where: { id: taskId },
      include: { event: { select: { created_by: true } } }
    });

    if (!task || task.event_id !== eventId) {
      throw new Error("Task not found.");
    }

    const isTaskCreator = task.created_by_id === userId;
    const isEventCreator = task.event.created_by === userId;

    if (!isTaskCreator && !isEventCreator) {
      const staffRole = await prisma.eventUserRole.findUnique({
        where: { event_id_user_id: { event_id: eventId, user_id: userId } },
        include: { role: true }
      });
      if (!staffRole || staffRole.role.name !== 'Admin') {
        throw new Error("Unauthorized to delete this task.");
      }
    }

    return (prisma as any).eventStaffTask.delete({ where: { id: taskId } });
  }
};
