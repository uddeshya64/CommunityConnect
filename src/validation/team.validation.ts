import { z } from 'zod';

// 1. Schema for Starting Registration
export const StartRegistrationSchema = z.object({
  eventId: z.coerce.number().int().positive("Valid Event ID is required"),
  // .trim() prevents users from passing just spaces like "   "
  teamName: z.string().trim().min(3, "Team name must be at least 3 characters").max(50, "Team name is too long").optional(),
  members: z.array(z.object({
    email: z.string().trim().email("Valid member email is required"),
    role: z.string().optional(),
  })).optional(),
});

// 2. Schema for Verifying Razorpay Payment
export const VerifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1, "Razorpay Order ID is required"),
  razorpay_payment_id: z.string().min(1, "Razorpay Payment ID is required"),
  razorpay_signature: z.string().min(1, "Razorpay Signature is required"),
  team_id: z.coerce.number().int().positive("Valid Team ID is required").optional(),
  registration_id: z.coerce.number().int().optional(),
});

// 3. Schema for Inviting a Team Member (For the dashboard)
export const InviteMemberSchema = z.object({
  email: z.string().trim().email("Please provide a valid email address"),
});