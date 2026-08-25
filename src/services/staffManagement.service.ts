import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { EmailService } from './email.service';
import { EVENT_PERMISSIONS, EventPermission } from '../utils/constants/permissions';
import { PushService } from './push.service';

const prisma = new PrismaClient();

export class EventStaffService {

  // Fetch all available roles for a specific event
  static async getRoles(eventId: number) {
    return prisma.eventRoleDefinition.findMany({
      where: { event_id: eventId },
      select: {
        id: true,
        name: true,
        permissions: true,
        is_system: true
      },
      orderBy: { name: 'asc' }
    });
  }

  // ==========================================
  // 1. CREATE A CUSTOM ROLE
  // ==========================================
  static async createCustomRole(eventId: number, name: string, permissions: EventPermission[]) {
    // Validate that the event exists
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    return prisma.eventRoleDefinition.create({
      data: {
        event_id: eventId,
        name: name,
        permissions: permissions, // e.g., ["MANAGE_COMMUNICATIONS", "VIEW_DASHBOARD"]
        is_system: false // Marks this as a user-created role, not a default
      }
    });
  }

  // ==========================================
  // 2. INVITE A STAFF MEMBER (MAGIC LINK)
  // ==========================================
  static async inviteStaff(eventId: number, email: string, roleId: number) {
    // 1. Verify the role actually belongs to this event
    const role = await prisma.eventRoleDefinition.findUnique({ 
      where: { id: roleId },
      include: { event: true } 
    });

    if (!role || role.event_id !== eventId) {
      throw new Error("Invalid role selected for this event");
    }

    // 2. Prevent duplicate pending invites
    const existingInvite = await prisma.eventStaffInvite.findFirst({
      where: { event_id: eventId, email: email, status: 'pending' }
    });
    if (existingInvite) throw new Error("An invitation is already pending for this email");

    // 3. Generate Secure Magic Link Token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // Valid for 7 days

    // 4. Save/Update to Database using Upsert to prevent unique constraint crashes
    const invite = await prisma.eventStaffInvite.upsert({
      where: {
        event_id_email: {
          event_id: eventId,
          email: email.toLowerCase()
        }
      },
      update: {
        role_id: roleId,
        token: token,
        status: 'pending',
        expires_at: expiresAt,
        created_at: new Date()
      },
      create: {
        event_id: eventId,
        email: email.toLowerCase(),
        role_id: roleId,
        token: token,
        expires_at: expiresAt
      }
    });

    // 5. Fire & Forget Email and Push Notification
    const magicLink = `${process.env.FRONTEND_URL}/join-staff?token=${token}`;
    
    EmailService.sendTeamInvite(email, `${role.event.title} as a ${role.name}`, magicLink).catch(console.error);
    PushService.sendPushToEmail(email, {
      title: 'Staff Invitation Received',
      body: `You've been invited to join the staff for "${role.event.title}" as a ${role.name}.`,
      url: `/join-staff?token=${token}`,
      tag: `staff-invite-${role.event_id}`,
      actions: [{ action: 'open', title: 'View Role' }],
    }).catch(console.error);

    return { success: true, message: "Staff invitation sent successfully!" };
  }

  // ==========================================
  // 3. ACCEPT STAFF INVITATION
  // ==========================================
  static async acceptInvite(userId: number, token: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const invite = await prisma.eventStaffInvite.findUnique({ 
      where: { token },
      include: { role: true }
    });

    // Validations
    if (!invite) throw new Error("Invalid invitation token");
    if (invite.status !== 'pending') throw new Error("Invitation already used or revoked");
    if (invite.expires_at < new Date()) throw new Error("Invitation has expired");
    if (invite.email !== user.email) throw new Error("This invite was sent to a different email address");

    // TRANSACTION: Mark invite used & Create Employment Contract
    return prisma.$transaction(async (tx) => {
      
      // A. Mark Invite Accepted
      await tx.eventStaffInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted' }
      });

      // B. Create the EventUserRole (The "Contract")
      await tx.eventUserRole.create({
        data: {
          event_id: invite.event_id,
          user_id: userId,
          role_id: invite.role_id,
          permissions_override: [] // Default to no overrides
        }
      });

      return { success: true, eventId: invite.event_id, roleName: invite.role.name };
    });
  }

  // ==========================================
  // 3b. DECLINE STAFF INVITATION
  // ==========================================
  static async declineInvite(userId: number, token: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const invite = await prisma.eventStaffInvite.findUnique({ where: { token } });
    if (!invite) throw new Error("Invalid invitation token");
    if (invite.status !== 'pending') throw new Error("Invitation already processed");
    if (invite.email !== user.email) {
      throw new Error("This invite was sent to a different email address.");
    }

    return prisma.eventStaffInvite.update({
      where: { id: invite.id },
      data: { status: 'declined' }
    });
  }
  // ==========================================
  // 4. VERIFY INVITATION (PUBLIC)
  // ==========================================
  static async verifyInviteToken(token: string) {
    const invite = await prisma.eventStaffInvite.findUnique({
      where: { token },
      include: {
        event: { select: { title: true, banner_url: true } },
        role: { select: { name: true } }
      }
    });

    if (!invite) throw new Error("Invalid invitation link.");
    if (invite.status !== 'pending') throw new Error("This invitation has already been used or revoked.");
    if (invite.expires_at < new Date()) throw new Error("This invitation has expired.");

    // Return safe, non-sensitive data for the frontend to display
    return {
      emailInvited: invite.email,
      eventName: invite.event.title,
      eventBanner: invite.event.banner_url,
      roleName: invite.role.name
    };
  }

  // 5. SECURE TICKET CHECK-IN
  static async checkInParticipant(eventId: number, staffUserId: number, ticketCode: string) {
    const registration = await prisma.registration.findUnique({
      where: { ticket_code: ticketCode },
      include: {
        user: { select: { name: true, email: true } },
        team: { select: { name: true } }
      }
    });

    if (!registration) throw new Error("Ticket not found or invalid.");
    if (registration.event_id !== eventId) {
      throw new Error("This ticket is registered for a different event.");
    }
    if (registration.status !== 'confirmed') {
      throw new Error("This registration is not confirmed yet.");
    }
    if (registration.checked_in) {
      const timeString = registration.checked_in_at
        ? new Date(registration.checked_in_at).toLocaleTimeString()
        : 'unknown';
      throw new Error(`Participant has already checked in at ${timeString}.`);
    }

    return prisma.registration.update({
      where: { id: registration.id },
      data: {
        checked_in: true,
        checked_in_at: new Date(),
        checked_in_by: staffUserId
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        team: { select: { id: true, name: true } }
      }
    });
  }
}