import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { EmailService } from './email.service';
import { EVENT_PERMISSIONS, EventPermission, getDefaultPermissionsForRole } from '../utils/constants/permissions';
import { PushService } from './push.service';

const prisma = new PrismaClient();

export class EventStaffService {

  // Fetch all available roles for a specific event
  static async getRoles(eventId: number) {
    const roles = await prisma.eventRoleDefinition.findMany({
      where: { event_id: eventId },
      select: {
        id: true,
        name: true,
        permissions: true,
        is_system: true
      },
      orderBy: { name: 'asc' }
    });

    return roles.map((r) => {
      let perms = (r.permissions as string[]) || [];
      if (!perms || perms.length === 0) {
        perms = getDefaultPermissionsForRole(r.name);
      } else {
        if (!perms.includes(EVENT_PERMISSIONS.VIEW_DASHBOARD)) {
          perms = [...perms, EVENT_PERMISSIONS.VIEW_DASHBOARD];
        }
        if (r.name.toLowerCase().includes('registration')) {
          perms = Array.from(
            new Set([
              ...perms,
              EVENT_PERMISSIONS.MANAGE_ATTENDEES,
              EVENT_PERMISSIONS.MANAGE_FORMS,
              EVENT_PERMISSIONS.MANAGE_TICKETS,
              EVENT_PERMISSIONS.MANAGE_INVITATIONS,
              EVENT_PERMISSIONS.MANAGE_CHECK_IN,
              EVENT_PERMISSIONS.MANAGE_REFUNDS,
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ])
          );
        }
        if (r.name.toLowerCase().includes('admin')) {
          perms = Object.values(EVENT_PERMISSIONS);
        }
      }
      return { ...r, permissions: perms };
    });
  }

  // ==========================================
  // 1. CREATE A CUSTOM ROLE
  // ==========================================
  static async createCustomRole(eventId: number, name: string, permissions: EventPermission[]) {
    // Validate that the event exists
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    const effectivePerms = (permissions && permissions.length > 0)
      ? permissions
      : getDefaultPermissionsForRole(name);

    return prisma.eventRoleDefinition.create({
      data: {
        event_id: eventId,
        name: name,
        permissions: effectivePerms,
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

  // 6. GET ALL ASSIGNED STAFF & PENDING INVITES FOR AN EVENT
  static async getStaff(eventId: number) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        created_by: true,
        creator: {
          select: { id: true, name: true, email: true, avatar_url: true }
        }
      }
    });
    if (!event) throw new Error("Event not found");

    const staffRoles = await prisma.eventUserRole.findMany({
      where: { event_id: eventId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar_url: true } },
        role: { select: { id: true, name: true, permissions: true, is_system: true } }
      },
      orderBy: { assigned_at: 'asc' }
    });

    const pendingInvites = await prisma.eventStaffInvite.findMany({
      where: { event_id: eventId, status: 'pending' },
      include: {
        role: { select: { id: true, name: true } }
      },
      orderBy: { created_at: 'desc' }
    });

    const formattedStaff = staffRoles.map((st) => {
      const userOverrides = st.permissions_override as string[] | null;
      let effectivePermissions = Array.isArray(userOverrides) && userOverrides.length > 0
        ? userOverrides
        : ((st.role?.permissions as string[]) || []);

      if (!effectivePermissions || effectivePermissions.length === 0) {
        effectivePermissions = getDefaultPermissionsForRole(st.role?.name || '');
      } else {
        if (!effectivePermissions.includes(EVENT_PERMISSIONS.VIEW_DASHBOARD)) {
          effectivePermissions = [...effectivePermissions, EVENT_PERMISSIONS.VIEW_DASHBOARD];
        }
        if (st.role?.name?.toLowerCase().includes('registration')) {
          effectivePermissions = Array.from(
            new Set([
              ...effectivePermissions,
              EVENT_PERMISSIONS.MANAGE_ATTENDEES,
              EVENT_PERMISSIONS.MANAGE_FORMS,
              EVENT_PERMISSIONS.MANAGE_TICKETS,
              EVENT_PERMISSIONS.MANAGE_INVITATIONS,
              EVENT_PERMISSIONS.MANAGE_CHECK_IN,
              EVENT_PERMISSIONS.MANAGE_REFUNDS,
              EVENT_PERMISSIONS.VIEW_DASHBOARD
            ])
          );
        }
        if (st.role?.name?.toLowerCase().includes('admin')) {
          effectivePermissions = Object.values(EVENT_PERMISSIONS);
        }
      }

      return {
        ...st,
        role: st.role ? {
          ...st.role,
          permissions: effectivePermissions
        } : st.role
      };
    });

    return {
      creator: event.creator,
      staff: formattedStaff,
      pendingInvites: pendingInvites
    };
  }

  // 7. UPDATE STAFF ROLE & PERMISSIONS OVERRIDE (DIRECT ADMIN CHANGE)
  static async updateStaff(eventId: number, targetUserId: number, adminUserId?: number, roleId?: number, permissionsOverride?: string[]) {
    const staffRecord = await prisma.eventUserRole.findUnique({
      where: { event_id_user_id: { event_id: eventId, user_id: targetUserId } }
    });
    if (!staffRecord) throw new Error("Staff member not found for this event.");

    const dataToUpdate: any = {};
    if (roleId) {
      const roleDef = await prisma.eventRoleDefinition.findUnique({ where: { id: roleId } });
      if (!roleDef || roleDef.event_id !== eventId) {
        throw new Error("Invalid role specified.");
      }
      dataToUpdate.role_id = roleId;
    }
    if (Array.isArray(permissionsOverride)) {
      dataToUpdate.permissions_override = permissionsOverride;
    }

    // Update staff role in database
    const updatedStaff = await prisma.eventUserRole.update({
      where: { id: staffRecord.id },
      data: dataToUpdate,
      include: {
        user: { select: { id: true, name: true, email: true, avatar_url: true } },
        role: { select: { id: true, name: true, permissions: true, is_system: true } },
        event: { select: { id: true, title: true } }
      }
    });

    // Notify the target user about the direct role change
    if (adminUserId) {
      const adminUser = await prisma.user.findUnique({
        where: { id: adminUserId },
        select: { name: true }
      });
      const adminName = adminUser?.name || "An Admin";
      const eventTitle = updatedStaff.event.title;
      const newRoleName = updatedStaff.role.name;

      PushService.sendPushToUser(targetUserId, {
        title: `Role Changed in ${eventTitle}`,
        body: `Your role has been changed to ${newRoleName} for "${eventTitle}" by ${adminName}.`,
        url: `/events/${eventId}`,
        tag: `role-update-${eventId}`,
        actions: [{ action: "open", title: "View Event" }]
      }).catch(console.error);

      if (updatedStaff.user.email) {
        PushService.sendPushToEmail(updatedStaff.user.email, {
          title: `Role Changed in ${eventTitle}`,
          body: `Your role has been changed to ${newRoleName} for "${eventTitle}" by ${adminName}.`,
          url: `/events/${eventId}`,
          tag: `role-update-${eventId}`
        }).catch(console.error);
      }
    }

    return updatedStaff;
  }

  // 8. REMOVE A STAFF MEMBER
  static async removeStaff(eventId: number, targetUserId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found.");

    if (event.created_by === targetUserId) {
      throw new Error("Cannot remove the event creator from event staff.");
    }

    const staffUser = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true }
    });

    // A. Delete EventUserRole (Revoke staff contract & access)
    await prisma.eventUserRole.deleteMany({
      where: { event_id: eventId, user_id: targetUserId }
    });

    // B. Delete any pending or accepted EventStaffInvite for this user's email
    if (staffUser?.email) {
      await prisma.eventStaffInvite.deleteMany({
        where: { event_id: eventId, email: staffUser.email.toLowerCase() }
      });
    }

    return { success: true, message: "Staff member removed and access revoked successfully." };
  }

  // 9. CANCEL / REVOKE PENDING INVITE
  static async cancelInvite(eventId: number, inviteId: number) {
    const invite = await prisma.eventStaffInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.event_id !== eventId) {
      throw new Error("Invitation not found.");
    }

    // A. Find if a user exists with this invited email
    const invitedUser = await prisma.user.findUnique({
      where: { email: invite.email.toLowerCase() }
    });

    // B. Delete all invites for this email and event
    await prisma.eventStaffInvite.deleteMany({
      where: { event_id: eventId, email: invite.email.toLowerCase() }
    });

    // C. Delete any EventUserRole contract for this user on this event (revoking staff access immediately)
    if (invitedUser) {
      await prisma.eventUserRole.deleteMany({
        where: {
          event_id: eventId,
          user_id: invitedUser.id
        }
      });
    }

    return { success: true, message: "Invitation cancelled and staff access revoked." };
  }
}