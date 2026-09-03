import { Request, Response } from 'express';
import { CheckoutService } from '../services/checkout.service';
import { StartRegistrationSchema, VerifyPaymentSchema } from '../validation/team.validation';
import { ZodError } from 'zod';

export const TeamController = {

  async startRegistration(req: Request, res: Response) {
    try {
      const { eventId, teamName, members } = StartRegistrationSchema.parse(req.body);
      const userId = req.user!.id;

      // DYNAMIC DISPATCH: If teamName exists, use team flow; otherwise, use individual 
      const result = teamName 
        ? await CheckoutService.initializeTeamRegistration(userId, Number(eventId), teamName, members)
        : await CheckoutService.initializeIndividualRegistration(userId, Number(eventId));

      if (result.isFree) {
        return res.json({
          success: true,
          isFree: true,
          message: "Registration successful!",
          data: {
            // Return team_id if it exists, otherwise registration_id
            team_id: (result as any).team?.id || null,
            registration_id: result.registration.id
          }
        });
      }

      if (!result.order) {
        throw new Error("Failed to generate payment order.");
      }

      return res.json({
        success: true,
        isFree: false,
        data: {
          // Send registration_id as the primary reference for individual payments
          registration_id: result.registration.id, 
          team_id: (result as any).team?.id || null,
          razorpay_order_id: result.order.id,
          amount: result.order.amount,
          currency: result.order.currency
        }
      });

    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(500).json({ error: error.message });
    }
  },

  async verifyPayment(req: Request, res: Response) {
    try {
      // Use registrationId if teamId is not present (Individual flow) 
      const { 
        razorpay_order_id, 
        razorpay_payment_id, 
        razorpay_signature, 
        team_id,
        registration_id
      } = VerifyPaymentSchema.parse(req.body);

      if (team_id) {
        await CheckoutService.verifyTeamPayment(
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          Number(team_id)
        );
      } else if (registration_id) {
        await CheckoutService.verifyIndividualPayment(
          razorpay_order_id,
          razorpay_payment_id,
          razorpay_signature,
          Number(registration_id)
        );
      } else {
        throw new Error("Missing reference ID for verification.");
      }

      res.json({ success: true, message: "Payment successful!" });
    } catch (error: any) {
      if (error instanceof ZodError) return res.status(400).json({ error: "Validation Error", details: error.issues });
      res.status(400).json({ error: error.message });
    }
  }
};