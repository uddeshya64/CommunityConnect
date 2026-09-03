import { Request, Response } from 'express';
import { EventStaffService } from '../services/staffManagement.service';
import { CreateCustomRoleSchema, InviteStaffSchema, AcceptStaffInviteSchema, CheckInSchema } from '../validation/eventStaff.validation';
import { ZodError } from 'zod';

export const EventStaffController = {

  // GET ALL ROLES FOR AN EVENT
  async getRoles(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      
      // Assuming your EventStaffService has a method to get roles. 
      // If it doesn't, you can query Prisma directly here.
      const roles = await EventStaffService.getRoles(eventId); 

      res.json({ success: true, data: roles });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 1. CREATE CUSTOM ROLE
  async createCustomRole(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const validatedData = CreateCustomRoleSchema.parse(req.body);

      const newRole = await EventStaffService.createCustomRole(
        eventId, 
        validatedData.name, 
        validatedData.permissions as any
      );

      res.status(201).json({ success: true, message: "Custom role created", data: newRole });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  // 2. INVITE STAFF MEMBER
  async inviteStaff(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const { email, roleId } = InviteStaffSchema.parse(req.body);

      const result = await EventStaffService.inviteStaff(eventId, email, roleId);

      res.json({ success: true, message: result.message });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  // GET /api/staff/verify-invite/:token
  async verifyInvite(req: Request, res: Response) {
    try {
      const token = req.params.token as string;
      const details = await EventStaffService.verifyInviteToken(token);
      
      res.json({ success: true, data: details });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 3. ACCEPT INVITATION
  async acceptInvite(req: Request, res: Response) {
    try {
      const userId = req.user!.id; // Authenticated user clicking the link
      const { token } = AcceptStaffInviteSchema.parse(req.body);

      const result = await EventStaffService.acceptInvite(userId, token);

      res.json({ 
        success: true, 
        message: `Successfully joined event as ${result.roleName}!`,
        eventId: result.eventId 
      });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  // 3b. DECLINE STAFF INVITATION
  async declineInvite(req: Request, res: Response) {
    try {
      const userId = req.user!.id;
      const { token } = AcceptStaffInviteSchema.parse(req.body);

      await EventStaffService.declineInvite(userId, token);

      res.json({ 
        success: true, 
        message: "Successfully declined the staff invitation."
      });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  // 4. CHECK-IN PARTICIPANT
  async checkInParticipant(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const staffUserId = req.user!.id;
      const { ticketCode } = CheckInSchema.parse(req.body);

      const updatedReg = await EventStaffService.checkInParticipant(eventId, staffUserId, ticketCode);

      res.json({
        success: true,
        message: `${updatedReg.user.name} checked in successfully!`,
        data: {
          id: updatedReg.id,
          user: updatedReg.user,
          team: updatedReg.team,
          checked_in_at: updatedReg.checked_in_at
        }
      });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  },

  // 5. GET ALL STAFF & INVITES
  async getStaff(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const data = await EventStaffService.getStaff(eventId);
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 6. UPDATE STAFF MEMBER ROLE & PERMISSIONS
  async updateStaff(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const targetUserId = Number(req.params.userId);
      const adminUserId = req.user!.id;
      const { roleId, permissionsOverride } = req.body;

      const updatedStaff = await EventStaffService.updateStaff(
        eventId,
        targetUserId,
        adminUserId,
        roleId ? Number(roleId) : undefined,
        permissionsOverride
      );

      res.json({
        success: true,
        message: "Staff role & permissions updated directly. Notification sent to member.",
        data: updatedStaff
      });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 7. REMOVE STAFF MEMBER
  async removeStaff(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const targetUserId = Number(req.params.userId);

      const result = await EventStaffService.removeStaff(eventId, targetUserId);
      res.json({ success: true, message: result.message });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  },

  // 8. CANCEL PENDING INVITATION
  async cancelInvite(req: Request, res: Response) {
    try {
      const eventId = Number(req.params.eventId);
      const inviteId = Number(req.params.inviteId);

      const result = await EventStaffService.cancelInvite(eventId, inviteId);
      res.json({ success: true, message: result.message });
    } catch (error: any) {
      res.status(400).json({ error: error.message });
    }
  }

};
