import { PrismaClient } from '@prisma/client';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { config } from '../config/env';
import { EmailService } from './email.service';
import { PushService } from './push.service';
import { RecommendationService } from './recommendation.service';

const prisma = new PrismaClient();

// Initialize Razorpay (Ensure these are in your .env)
const razorpay = new Razorpay({
  key_id: config.RAZORPAY_KEY_ID!,
  key_secret: config.RAZORPAY_KEY_SECRET!,
});

export class CheckoutService {
  // Helper to send registration confirmation push notification
  static async sendRegistrationPush(registrationId: number) {
    try {
      const reg = await prisma.registration.findUnique({
        where: { id: registrationId },
        include: { event: true, user: true }
      });
      if (!reg) return;

      await PushService.sendPushToUser(reg.user_id, {
        title: "Registration Confirmed! 🎉",
        body: `You're all set for "${reg.event.title}". Tap to view your entry pass & QR ticket.`,
        url: `/events/${reg.event_id}`,
        tag: `ticket-${reg.id}`,
        actions: [{ action: "open", title: "View Ticket" }],
      });
    } catch (err: any) {
      console.error(`[PUSH_ERROR] Failed to send registration push for ${registrationId}:`, err.message);
    }
  }
// ==========================================
  // 1. TEAM REGISTRATION FLOW (UPDATED)
  // ==========================================
  static async initializeTeamRegistration(userId: number, eventId: number, teamName: string) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    // Capacity Check
    if (event.capacity > 0) {
      const confirmedCount = await prisma.registration.count({
        where: { event_id: eventId, status: 'confirmed' }
      });
      if (confirmedCount >= event.capacity) {
        throw new Error("This event has reached its maximum participation capacity.");
      }
    }

    const fee = Number(event.registration_fee);
    const isFree = fee === 0;

    // A. THE FIX: Check if the user already has a registration for this event
    const existingRegistration = await prisma.registration.findFirst({
      where: { user_id: userId, event_id: eventId },
      include: { team: true }
    });

    if (existingRegistration) {
      // If they already paid, block them completely
      if (existingRegistration.status === 'confirmed') {
        throw new Error("You are already registered for this event.");
      }

      // B. REUSE LOGIC: If it's pending, reuse the existing team and registration!
      if (existingRegistration.status === 'pending' && existingRegistration.team) {
        
        // Optionally update the team name if they changed it on the frontend retry
        if (existingRegistration.team.name !== teamName) {
          await prisma.team.update({
            where: { id: existingRegistration.team.id },
            data: { name: teamName }
          });
          existingRegistration.team.name = teamName;
        }

        if (isFree) {
          // Edge case: It was pending, but now it's free. Confirm it.
          await prisma.registration.update({ where: { id: existingRegistration.id }, data: { status: 'confirmed' } });
          await prisma.team.update({ where: { id: existingRegistration.team.id }, data: { status: 'active' } });
          EmailService.sendRegistrationConfirmationEmail(existingRegistration.id).catch(err => 
            console.error(`[EMAIL_ERROR] Failed to send email for registration ${existingRegistration.id}:`, err)
          );
          return { isFree: true, team: existingRegistration.team, registration: existingRegistration };
        }

        // Generate a fresh Razorpay order for the EXISTING team
        // We append Date.now() to the receipt so Razorpay doesn't complain about duplicate receipts
        const amountInPaisa = fee * 100;
        const order = await razorpay.orders.create({
          amount: amountInPaisa,
          currency: "INR",
          receipt: `receipt_team_${existingRegistration.team.id}_retry_${Date.now()}`,
        });

        // Return the existing data
        return { isFree: false, team: existingRegistration.team, registration: existingRegistration, order };
      }
    }

    // C. NORMAL FLOW: If no registration exists at all, create a brand new one
    const result = await prisma.$transaction(async (tx) => {
      const team = await tx.team.create({
        data: {
          name: teamName,
          event_id: eventId,
          leader_id: userId,
          status: isFree ? 'active' : 'draft' 
        }
      });

      await tx.teamMember.create({
        data: { team_id: team.id, user_id: userId }
      });

      const ticketCode = `cc_tck_${crypto.randomBytes(12).toString('hex')}`;
      const registration = await tx.registration.create({
        data: {
          user_id: userId,
          event_id: eventId,
          team_id: team.id,
          status: isFree ? 'confirmed' : 'pending',
          ticket_code: ticketCode
        }
      });

      if (isFree) {
        await tx.payment.create({
          data: {
            registration_id: registration.id,
            amount: 0,
            currency: 'INR',
            provider: 'SYSTEM',
            status: 'success',
            transaction_ref: `FREE_TEAM_${Date.now()}`
          }
        });
        return { isFree: true, team, registration };
      }

      const amountInPaisa = fee * 100;
      const order = await razorpay.orders.create({
        amount: amountInPaisa,
        currency: "INR",
        receipt: `receipt_team_${team.id}`,
      });

      return { isFree: false, team, registration, order };
    });

    if (result.isFree && result.registration.status === 'confirmed') {
      EmailService.sendRegistrationConfirmationEmail(result.registration.id).catch(err => 
        console.error(`[EMAIL_ERROR] Failed to send email for registration ${result.registration.id}:`, err)
      );
    }

    return result;
  }


  // ==========================================
  // 2. INDIVIDUAL REGISTRATION FLOW (UPDATED)
  // ==========================================
  static async initializeIndividualRegistration(userId: number, eventId: number) {
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new Error("Event not found");

    // Capacity Check
    if (event.capacity > 0) {
      const confirmedCount = await prisma.registration.count({
        where: { event_id: eventId, status: 'confirmed' }
      });
      if (confirmedCount >= event.capacity) {
        throw new Error("This event has reached its maximum participation capacity.");
      }
    }

    if (event.registration_type !== 'individual' && event.min_team_size > 1) {
      throw new Error("This event requires you to register as a team.");
    }

    const fee = Number(event.registration_fee);
    const isFree = fee === 0;

    // A. THE FIX: Check for existing individual registration
    const existingRegistration = await prisma.registration.findFirst({
      where: { event_id: eventId, user_id: userId }
    });

    if (existingRegistration) {
      if (existingRegistration.status === 'confirmed') {
        throw new Error("You are already registered for this event.");
      }

      // B. REUSE LOGIC: If pending, just generate a new Razorpay order
      if (existingRegistration.status === 'pending') {
        if (isFree) {
          await prisma.registration.update({ where: { id: existingRegistration.id }, data: { status: 'confirmed' } });
          EmailService.sendRegistrationConfirmationEmail(existingRegistration.id).catch(err => 
            console.error(`[EMAIL_ERROR] Failed to send email for registration ${existingRegistration.id}:`, err)
          );
          return { isFree: true, registration: existingRegistration };
        }

        const amountInPaisa = fee * 100;
        const order = await razorpay.orders.create({
          amount: amountInPaisa,
          currency: "INR",
          receipt: `receipt_ind_${existingRegistration.id}_retry_${Date.now()}`,
        });

        return { isFree: false, registration: existingRegistration, order };
      }
    }

    // C. NORMAL FLOW: Create brand new registration
    const result = await prisma.$transaction(async (tx) => {
      const ticketCode = `cc_tck_${crypto.randomBytes(12).toString('hex')}`;
      const registration = await tx.registration.create({
        data: {
          user_id: userId,
          event_id: eventId,
          status: isFree ? 'confirmed' : 'pending',
          ticket_code: ticketCode
        }
      });

      if (isFree) {
        await tx.payment.create({
          data: {
            registration_id: registration.id,
            amount: 0,
            currency: 'INR',
            provider: 'SYSTEM',
            status: 'success',
            transaction_ref: `FREE_IND_${Date.now()}`
          }
        });
        return { isFree: true, registration };
      }

      const amountInPaisa = fee * 100;
      const order = await razorpay.orders.create({
        amount: amountInPaisa,
        currency: "INR",
        receipt: `receipt_ind_${registration.id}`,
      });

      return { isFree: false, registration, order };
    });

    if (result.isFree && result.registration.status === 'confirmed') {
      EmailService.sendRegistrationConfirmationEmail(result.registration.id).catch(err => 
        console.error(`[EMAIL_ERROR] Failed to send email for registration ${result.registration.id}:`, err)
      );
    }

    return result;
  } 

  // 2. VERIFY INDIVIDUAL PAYMENT
  static async verifyIndividualPayment(
    razorpayOrderId: string, 
    razorpayPaymentId: string, 
    razorpaySignature: string,
    registrationId: number
  ) {
    // A. Cryptographic Verification
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', config.RAZORPAY_KEY_SECRET!)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      throw new Error("Invalid payment signature. Payment rejected.");
    }

    // B. If valid, update database
    const result = await prisma.$transaction(async (tx) => {
      const registration = await tx.registration.findUnique({ 
        where: { id: registrationId },
        include: { event: true }
      });

      if (!registration) throw new Error("Registration not found");

      // 1. Save Payment Record
      await tx.payment.create({
        data: {
          registration_id: registration.id,
          amount: registration.event.registration_fee,
          currency: 'INR',
          provider: 'Razorpay',
          status: 'success',
          transaction_ref: razorpayPaymentId
        }
      });

      // 2. Mark Registration as Confirmed
      await tx.registration.update({
        where: { id: registration.id },
        data: { status: 'confirmed' }
      });

      return { success: true, registrationId: registration.id };
    });

    EmailService.sendRegistrationConfirmationEmail(result.registrationId).catch(err => 
      console.error(`[EMAIL_ERROR] Failed to send email for registration ${result.registrationId}:`, err)
    );

    // Trigger ML Personal Agenda recommendation engine
    prisma.registration.findUnique({ where: { id: result.registrationId } }).then(reg => {
      if (reg) RecommendationService.generatePersonalAgenda(reg.user_id, reg.event_id).catch(() => {});
    });

    return { success: result.success, registrationId: result.registrationId };
  }
  // 2. VERIFY SECURE SIGNATURE & ACTIVATE TEAM
  static async verifyTeamPayment(
    razorpayOrderId: string, 
    razorpayPaymentId: string, 
    razorpaySignature: string,
    teamId: number
  ) {
    // A. Cryptographic Verification (DO NOT SKIP)
    const body = razorpayOrderId + "|" + razorpayPaymentId;
    const expectedSignature = crypto
      .createHmac('sha256', config.RAZORPAY_KEY_SECRET!)
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      throw new Error("Invalid payment signature. Payment rejected.");
    }

    // B. If valid, update database
    const result = await prisma.$transaction(async (tx) => {
      // Find the pending registration for this team's leader
      const team = await tx.team.findUnique({ 
        where: { id: teamId },
        include: { registrations: true,
            event: { 
            select: { registration_fee: true } 
          }
         } 
      });

      if (!team || team.registrations.length === 0) throw new Error("Team/Registration not found");

      const leaderRegistration = team.registrations.find(r => r.user_id === team.leader_id);
      if (!leaderRegistration) throw new Error("Leader registration not found");
      const actualAmountPaid = team.event.registration_fee;

      // 1. Save Payment Record
      await tx.payment.create({
        data: {
          registration_id: leaderRegistration.id,
          amount: actualAmountPaid,
          currency: 'INR',
          provider: 'Razorpay',
          status: 'success',
          transaction_ref: razorpayPaymentId
        }
      });

      // 2. Mark Team as Active!
      await tx.team.update({
        where: { id: teamId },
        data: { status: 'active' }
      });

      // 3. Mark Registration as Confirmed
      await tx.registration.update({
        where: { id: leaderRegistration.id },
        data: { status: 'confirmed' }
      });

      return { success: true, teamId: teamId, registrationId: leaderRegistration.id };
    });

    EmailService.sendRegistrationConfirmationEmail(result.registrationId).catch(err => 
      console.error(`[EMAIL_ERROR] Failed to send email for registration ${result.registrationId}:`, err)
    );

    // Trigger ML Personal Agenda recommendation engine
    prisma.registration.findUnique({ where: { id: result.registrationId } }).then(reg => {
      if (reg) RecommendationService.generatePersonalAgenda(reg.user_id, reg.event_id).catch(() => {});
    });

    return { success: result.success, teamId: result.teamId };
  }
}