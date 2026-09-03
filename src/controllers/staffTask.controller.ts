import { Request, Response } from 'express';
import { StaffTaskService } from '../services/staffTask.service';

export const StaffTaskController = {
  // 1. CREATE TASK
  async createTask(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const creatorId = req.user!.id;
      const { title, description, priority, assignedToId, dueDate } = req.body;

      if (!title || !assignedToId) {
        return res.status(400).json({ error: "Task title and assigned user ID are required." });
      }

      const task = await StaffTaskService.createTask(eventId, creatorId, {
        title,
        description,
        priority,
        assignedToId: Number(assignedToId),
        dueDate
      });

      res.status(201).json({
        success: true,
        message: "Task assigned successfully.",
        data: task
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 2. GET TASKS
  async getTasks(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const userId = req.user!.id;

      const tasks = await StaffTaskService.getTasksForUser(eventId, userId);

      res.json({
        success: true,
        data: tasks
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 3. UPDATE TASK STATUS
  async updateTaskStatus(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const taskId = Number(req.params.taskId);
      const userId = req.user!.id;
      const { status } = req.body;

      if (status !== 'pending' && status !== 'completed') {
        return res.status(400).json({ error: "Status must be 'pending' or 'completed'." });
      }

      const updatedTask = await StaffTaskService.updateTaskStatus(eventId, taskId, userId, status);

      res.json({
        success: true,
        message: `Task status updated to ${status}.`,
        data: updatedTask
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 4. DELETE TASK
  async deleteTask(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const taskId = Number(req.params.taskId);
      const userId = req.user!.id;

      await StaffTaskService.deleteTask(eventId, taskId, userId);

      res.json({
        success: true,
        message: "Task deleted successfully."
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }
};
