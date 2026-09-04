import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';
import { EmailService } from './email.service'; 
import { config } from '../config/env';
import { PushService } from './push.service';

const prisma = new PrismaClient();

export class TeamDashboardService {

  // 1. GET TEAM DETAILS (For the Dashboard UI)
  // 1. GET TEAM DETAILS (For the Dashboard UI)
  static async getTeamDetails(teamId: number, requestingUserId: number): Promise<any> {
    if (isNaN(teamId)) {
      throw new Error("Invalid team or registration ID");
    }

    // Try to find the team first
    let team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        members: {
          include: { user: { select: { id: true, name: true, email: true, avatar_url: true } } }
        },
        invites: {
          where: { status: 'pending' },
          select: { id: true, email: true, expires_at: true },
        },
        submissions: {
          orderBy: { submitted_at: 'desc' },
          include: {
            user: { select: { id: true, name: true, email: true } }
          }
        },
        event: {
          select: {
            id: true,
            title: true,
            banner_url: true,
            logo_url: true,
            start_date: true,
            end_date: true,
            min_team_size: true,
            max_team_size: true,
            registration_type: true,
            timelines: {
              orderBy: { start_time: 'asc' }
            }
          }
        }
      }
    });

    // If no team found, check if this is a solo registration ID
    if (!team) {
      const registration = await prisma.registration.findUnique({
        where: { id: teamId },
        include: {
          user: true,
          event: {
            select: {
              id: true,
              title: true,
              banner_url: true,
              logo_url: true,
              start_date: true,
              end_date: true,
              min_team_size: true,
              max_team_size: true,
              registration_type: true,
              timelines: {
                orderBy: { start_time: 'asc' }
              }
            }
          }
        }
      });

      if (!registration) throw new Error("Team or Registration not found");
      if (registration.user_id !== requestingUserId) {
        throw new Error("Unauthorized: You do not have access to this registration");
      }

      // If registration already has a team_id, recursive fetch using team_id
      if (registration.team_id) {
        return this.getTeamDetails(registration.team_id, requestingUserId);
      }

      // If registration does not have a team_id, create a solo team for them
      const createdTeam = await prisma.$transaction(async (tx) => {
        const teamName = `${registration.user.name}'s Space`;
        const newTeam = await tx.team.create({
          data: {
            name: teamName,
            event_id: registration.event_id,
            leader_id: requestingUserId,
            status: registration.status === 'confirmed' ? 'active' : 'draft'
          }
        });

        await tx.teamMember.create({
          data: {
            team_id: newTeam.id,
            user_id: requestingUserId
          }
        });

        await tx.registration.update({
          where: { id: registration.id },
          data: {
            team_id: newTeam.id
          }
        });

        return newTeam;
      });

      // Fetch the details of the newly created team
      return this.getTeamDetails(createdTeam.id, requestingUserId);
    }

    // Authorization: Only team members can view the dashboard
    const isMember = team.members.some(m => m.user_id === requestingUserId);
    if (!isMember) throw new Error("Unauthorized: You are not a member of this team");

    // Fetch all registrations for this team's event to get ticket codes and check-in statuses
    const registrations = await prisma.registration.findMany({
      where: {
        event_id: team.event_id,
        user_id: { in: team.members.map(m => m.user_id) }
      },
      select: {
        id: true,
        user_id: true,
        ticket_code: true,
        checked_in: true,
        checked_in_at: true
      }
    });

    const regMap = new Map(registrations.map(r => [r.user_id, r]));

    // Map through members and auto-generate missing ticket codes dynamically
    const membersWithTickets = await Promise.all(team.members.map(async (m) => {
      let regInfo = regMap.get(m.user_id);
      if (regInfo && !regInfo.ticket_code) {
        const ticketCode = `cc_tck_${crypto.randomBytes(12).toString('hex')}`;
        await prisma.registration.update({
          where: { id: regInfo.id },
          data: { ticket_code: ticketCode }
        });
        regInfo.ticket_code = ticketCode;
      }
      return {
        ...m,
        ticket_code: regInfo?.ticket_code || null,
        checked_in: regInfo?.checked_in || false,
        checked_in_at: regInfo?.checked_in_at || null
      };
    }));

    // 👇 NEW: Calculate capacity to make frontend UI rendering trivial
    // We count pending invites as "taken" seats so a leader can't accidentally over-invite
    const totalSeatsTaken = team.members.length + team.invites.length;
    const seatsAvailable = team.event.max_team_size - totalSeatsTaken;

    return {
      ...team,
      members: membersWithTickets,
      is_leader: team.leader_id === requestingUserId, 
      
      // Send pre-calculated state to the React frontend
      capacity: {
        is_full: seatsAvailable <= 0,
        seats_available: Math.max(0, seatsAvailable),
        meets_minimum: team.members.length >= team.event.min_team_size
      }
    };
  }

  // 2. UPDATE TEAM NAME
  static async updateTeamName(teamId: number, leaderId: number, newName: string) {
    // Check if the user is the actual leader
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.leader_id !== leaderId) {
      throw new Error("Unauthorized: Only the team leader can change the name");
    }

    return prisma.team.update({
      where: { id: teamId },
      data: { name: newName }
    });
  }

  // 3. INVITE A MEMBER (Moved from Checkout Service)
  static async inviteMember(teamId: number, leaderId: number, inviteeEmail: string) {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        event: { select: { title: true, registration_type: true, max_team_size: true } },
        members: true,
        invites: { where: { status: 'pending' } }
      }
    });
    if (!team || team.leader_id !== leaderId) {
      throw new Error("Unauthorized: Only the team leader can invite members");
    }

    if (team.event.registration_type === 'solo' || team.event.max_team_size <= 1) {
      throw new Error("This event is for solo participation and does not allow team members.");
    }

    const currentSeatsTaken = team.members.length + team.invites.length;
    if (currentSeatsTaken >= team.event.max_team_size) {
      throw new Error(`Team size limit reached. Maximum allowed members: ${team.event.max_team_size}`);
    }

    const normalizedEmail = inviteeEmail.toLowerCase();

    // 1. Check if already invited AND pending to prevent spam
    const existingPendingInvite = await prisma.teamInvite.findFirst({
      where: { team_id: teamId, email: normalizedEmail, status: 'pending' }
    });
    if (existingPendingInvite) {
      throw new Error("An invitation is already pending for this email");
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // 2. THE FIX: Use upsert to cleanly handle re-invites 
    // This overwrites any old 'accepted' or 'rejected' invite row for this email
    const invite = await prisma.teamInvite.upsert({
      where: {
        team_id_email: { 
          team_id: teamId, 
          email: normalizedEmail 
        }
      },
      update: {
        token: token,
        expires_at: expiresAt,
        status: 'pending' // Reset the status for the fresh invite
      },
      create: {
        team_id: teamId,
        email: normalizedEmail,
        token: token,
        expires_at: expiresAt
      }
    });

    // 3. Fire & Forget email and push notification
    const magicLink = `${config.FRONTEND_URL}/join-team?token=${token}`;
    EmailService.sendTeamInvite(normalizedEmail, team.name, magicLink).catch(console.error);
    PushService.sendPushToEmail(normalizedEmail, {
      title: 'Team Invitation Received',
      body: `You've been invited to join team "${team.name}" for ${team.event?.title || 'an event'}.`,
      url: `/join-team?token=${token}`,
      tag: `team-invite-${team.id}`,
      actions: [{ action: 'open', title: 'View Invitation' }],
    }).catch(console.error);

    return invite;
  }

  // 4. REMOVE A MEMBER
  static async removeMember(teamId: number, leaderId: number, userIdToRemove: number) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    
    if (!team || team.leader_id !== leaderId) {
      throw new Error("Unauthorized: Only the team leader can remove members");
    }

    if (leaderId === userIdToRemove) {
      throw new Error("The team leader cannot be removed. Transfer ownership or delete the team instead.");
    }

    // Use a transaction to ensure clean removal
    return prisma.$transaction(async (tx) => {
      // A. Remove from TeamMember junction table
      await tx.teamMember.delete({
        where: { team_id_user_id: { team_id: teamId, user_id: userIdToRemove } }
      });

      // B. Update their Registration status to cancelled (Optional, but good practice)
      await tx.registration.updateMany({
        where: { team_id: teamId, user_id: userIdToRemove },
        data: { status: 'cancelled' }
      });

      return { success: true, message: "Member removed successfully" };
    });
  }

  // ==========================================
  // 5. VERIFY TEAM INVITATION (PUBLIC)
  // ==========================================
  static async verifyInviteToken(token: string) {
    const invite = await prisma.teamInvite.findUnique({
      where: { token },
      include: {
        team: { 
          include: { 
            event: { select: { title: true, banner_url: true } } // Fetch event details for the UI
          } 
        }
      }
    });

    if (!invite) throw new Error("Invalid invitation link.");
    if (invite.status !== 'pending') throw new Error("This invitation has already been used or revoked.");
    if (invite.expires_at < new Date()) throw new Error("This invitation has expired.");

    // Return safe data for the frontend to display the "You're Invited!" screen
    return {
      emailInvited: invite.email,
      teamName: invite.team.name,
      eventName: invite.team.event.title,
      eventBanner: invite.team.event.banner_url
    };
  }

  // ==========================================
  // 6. ACCEPT TEAM INVITATION (SECURE)
  // ==========================================
  static async acceptInvite(userId: number, token: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const invite = await prisma.teamInvite.findUnique({ 
      where: { token },
      include: { 
        team: {
          include: {
            event: { select: { title: true, max_team_size: true, capacity: true } },
            _count: { select: { members: true } }
          }
        } 
      }
    });

    // Validations
    if (!invite) throw new Error("Invalid invitation token");
    if (invite.status !== 'pending') throw new Error("Invitation already used or revoked");
    if (invite.expires_at < new Date()) throw new Error("Invitation has expired");
    
    // Strict email check to prevent token forwarding
    if (invite.email !== user.email) {
      throw new Error("This invite was sent to a different email address. Please log in with the correct account.");
    }

    if (invite.team._count.members >= invite.team.event.max_team_size) {
      throw new Error(`This team has already reached the maximum limit of ${invite.team.event.max_team_size} members.`);
    }

    if (invite.team.event.capacity > 0) {
      const confirmedCount = await prisma.registration.count({
        where: { event_id: invite.team.event_id, status: 'confirmed' }
      });
      if (confirmedCount >= invite.team.event.capacity) {
        throw new Error("This event has reached its maximum participation capacity. No more members can join.");
      }
    }

    // Use a transaction to ensure all database steps succeed together
    const result = await prisma.$transaction(async (tx) => {
      
      // THE FIX 2: Check if user is already in a DIFFERENT team for this event
      const existingRegistration = await tx.registration.findFirst({
        where: { event_id: invite.team.event_id, user_id: userId }
      });

      if (existingRegistration?.team_id && existingRegistration.team_id !== invite.team_id) {
        const otherTeamId = existingRegistration.team_id;
        const otherTeam = await tx.team.findUnique({
          where: { id: otherTeamId },
          include: { _count: { select: { members: true } } }
        });

        if (otherTeam) {
          if (otherTeam.leader_id === userId) {
            if (otherTeam._count.members > 1) {
              throw new Error("You are the leader of another team for this event. You must transfer leadership or remove other members first.");
            } else {
              // Disassociate registration first to prevent cascade delete
              await tx.registration.updateMany({
                where: { team_id: otherTeamId, user_id: userId },
                data: { team_id: null, status: 'cancelled' }
              });
              // Automatically delete the empty team when they leave to join another
              await tx.team.delete({
                where: { id: otherTeamId }
              });
            }
          } else {
            // Disassociate registration first to prevent cascade delete
            await tx.registration.updateMany({
              where: { team_id: otherTeamId, user_id: userId },
              data: { team_id: null, status: 'cancelled' }
            });
            // Automatically remove them from the other team
            await tx.teamMember.delete({
              where: { team_id_user_id: { team_id: otherTeamId, user_id: userId } }
            });
          }
        }
      }

      // A. Mark Invite as Accepted
      await tx.teamInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted' }
      });

      // B. Add User to the Team
      // Note: If they double-click, Prisma's @@id([team_id, user_id]) constraint will catch it,
      // but you can wrap this in a try-catch to throw a cleaner error if you want.
      await tx.teamMember.create({
        data: {
          team_id: invite.team_id,
          user_id: userId
        }
      });

      // C. Handle Event Registration
      let registrationId: number;
      if (existingRegistration) {
        // Update existing registration to link to this team 
        const updatedReg = await tx.registration.update({
          where: { id: existingRegistration.id },
          data: { team_id: invite.team_id, status: 'confirmed' }
        });
        registrationId = updatedReg.id;
      } else {
        // Create a brand new registration for the event 
        const ticketCode = `cc_tck_${crypto.randomBytes(12).toString('hex')}`;
        const newReg = await tx.registration.create({
          data: {
            event_id: invite.team.event_id,
            user_id: userId,
            team_id: invite.team_id,
            status: 'confirmed',
            ticket_code: ticketCode
          }
        });
        registrationId = newReg.id;
      }

      return { 
        success: true, 
        teamId: invite.team_id, 
        teamName: invite.team.name,
        registrationId
      };
    });

    EmailService.sendRegistrationConfirmationEmail(result.registrationId).catch(err => 
      console.error(`[EMAIL_ERROR] Failed to send email for registration ${result.registrationId}:`, err)
    );

    // Notify the Team Leader via Push Notification
    PushService.sendPushToUser(invite.team.leader_id, {
      title: "New Team Member Joined! 👥",
      body: `${user.name || user.email} has joined your team "${invite.team.name}" for ${invite.team.event.title}.`,
      url: `/events/${invite.team.event_id}`,
      tag: `team-member-joined-${invite.team_id}`,
      actions: [{ action: "open", title: "View Team" }],
    }).catch((err) => {
      console.error(`[PUSH_ERROR] Failed to send team member joined push:`, err.message);
    });

    return { 
      success: result.success, 
      teamId: result.teamId, 
      teamName: result.teamName 
    };
  }

  // ==========================================
  // 6b. DECLINE TEAM INVITATION (SECURE)
  // ==========================================
  static async declineInvite(userId: number, token: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new Error("User not found");

    const invite = await prisma.teamInvite.findUnique({ where: { token } });
    if (!invite) throw new Error("Invalid invitation token");
    if (invite.status !== 'pending') throw new Error("Invitation already processed");
    if (invite.email !== user.email) {
      throw new Error("This invite was sent to a different email address.");
    }

    return prisma.teamInvite.update({
      where: { id: invite.id },
      data: { status: 'declined' }
    });
  }

  // 7. SUBMIT / UPDATE PROJECT
  static async submitProject(teamId: number, userId: number, title: string, repoUrl: string) {
    // Check membership
    const membership = await prisma.teamMember.findUnique({
      where: { team_id_user_id: { team_id: teamId, user_id: userId } }
    });
    if (!membership) {
      throw new Error("Unauthorized: You must be a team member to submit a project");
    }

    const team = await prisma.team.findUnique({
      where: { id: teamId }
    });
    if (!team) throw new Error("Team not found");

    // Check for existing submission for this team and event
    const existingSubmission = await prisma.submission.findFirst({
      where: { team_id: teamId, event_id: team.event_id }
    });

    if (existingSubmission) {
      return prisma.submission.update({
        where: { id: existingSubmission.id },
        data: {
          title,
          repo_url: repoUrl,
          user_id: userId
        }
      });
    } else {
      return prisma.submission.create({
        data: {
          team_id: teamId,
          event_id: team.event_id,
          user_id: userId,
          title,
          repo_url: repoUrl
        }
      });
    }
  }

  // 8. REVOKE PENDING INVITATION
  static async revokeInvite(teamId: number, leaderId: number, inviteId: number) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team || team.leader_id !== leaderId) {
      throw new Error("Unauthorized: Only the team leader can revoke invitations");
    }

    const invite = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
    if (!invite) throw new Error("Invitation not found");
    if (invite.team_id !== teamId) throw new Error("Invitation does not belong to this team");
    if (invite.status !== 'pending') throw new Error("Only pending invitations can be revoked");

    return prisma.teamInvite.delete({
      where: { id: inviteId }
    });
  }

  // 9. LEAVE TEAM
  static async leaveTeam(teamId: number, userId: number) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new Error("Team not found");

    const memberCount = await prisma.teamMember.count({
      where: { team_id: teamId }
    });

    if (team.leader_id === userId && memberCount > 1) {
      throw new Error("The team leader cannot leave the team when there are other members. You must transfer leadership or remove other members first.");
    }

    const membership = await prisma.teamMember.findUnique({
      where: { team_id_user_id: { team_id: teamId, user_id: userId } }
    });
    if (!membership) throw new Error("You are not a member of this team");

    return prisma.$transaction(async (tx) => {
      // A. Remove membership
      await tx.teamMember.delete({
        where: { team_id_user_id: { team_id: teamId, user_id: userId } }
      });

      // B. Cancel registration / disassociate from team
      await tx.registration.updateMany({
        where: { team_id: teamId, user_id: userId },
        data: { status: 'cancelled', team_id: null }
      });

      // C. If the leader left and was the only member, delete the team
      if (team.leader_id === userId && memberCount === 1) {
        await tx.team.delete({
          where: { id: teamId }
        });
      }

      return { success: true };
    });
  }
}