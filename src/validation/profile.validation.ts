import { z } from 'zod';

export const UpdateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  phone: z.string().regex(/^\+?[\d\s\-()]{7,20}$/, "Invalid phone format").optional().or(z.literal('')),
  
  // Array of strings for skills
  skills: z.array(z.string()).optional(),
  
  // URLs for social links
  linkedin: z.string().url("Invalid LinkedIn URL").optional().or(z.literal('')),
  github: z.string().url("Invalid GitHub URL").optional().or(z.literal('')),
  
  profession: z.string().max(50).optional(),
  avatar_url: z.string().url("Invalid profile image URL").optional().or(z.literal('')),
  bio: z.string().max(300,"Must be under 300 characters").optional().or(z.literal('')),
  location: z.string().optional(),
});