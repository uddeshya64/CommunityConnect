import { z } from "zod";
import { EventMode } from "@prisma/client";

// Defines the shape of one custom field the organizer builds
const CustomFieldDefinition = z.object({
  id: z.string(),
  label: z.string().min(1, "Field label is required"),
  type: z.enum([
    "text",
    "textarea",
    "number",
    "date",
    "select",
    "checkbox",
    "url",
    "phone",
    "email",
  ]),
  required: z.boolean().default(false),
  options: z.array(z.string()).optional(),
});

// Base Event Object
const EventBaseObject = z.object({
  title: z
    .string()
    .min(5, "Title must be at least 5 characters")
    .max(150),

  description: z
    .string()
    .min(20, "Description must be detailed"),

  type: z
    .string()
    .min(2, "Event type must be at least 2 characters")
    .max(50),

  mode: z.nativeEnum(EventMode),

  // Convert FormData string values automatically
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),

  registration_type: z.string(),

  // FIX: FormData sends these as strings
  registration_fee: z.coerce
    .number()
    .min(0, "Registration fee cannot be negative")
    .max(100000, "Registration fee cannot exceed ₹100,000"),

  max_team_size: z.coerce
    .number()
    .min(1, "Maximum team size must be at least 1"),

  min_team_size: z.coerce
    .number()
    .min(1, "Minimum team size must be at least 1"),

  capacity: z.coerce
    .number()
    .int("Capacity must be an integer")
    .nonnegative("Capacity cannot be negative")
    .default(0),

  banner_url: z
    .string()
    .url()
    .optional(),

  logo_url: z
    .string()
    .url()
    .optional(),

  rewards: z.any().optional(),

  custom_fields: z
    .record(z.string(), z.any())
    .optional(),

  custom_form_schema: z
    .array(CustomFieldDefinition)
    .optional(),

  location: z
    .string()
    .optional(),
});


// CREATE EVENT VALIDATION
export const CreateEventSchema = EventBaseObject.refine(
  (data) => data.start_date < data.end_date,
  {
    message: "End date must be after start date",
    path: ["end_date"],
  }
);


// UPDATE EVENT VALIDATION
export const UpdateEventSchema = EventBaseObject.partial().refine(
  (data) => {
    // Validate dates only if both are provided
    if (data.start_date && data.end_date) {
      return data.start_date < data.end_date;
    }

    return true;
  },
  {
    message: "End date must be after start date",
    path: ["end_date"],
  }
);

// EVENT TIMELINE (AGENDA) VALIDATION
export const BaseTimelineSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  speaker_name: z.string().max(100).optional().nullable(),
  description: z.string().optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).default([]),
  start_time: z.coerce.date(),
  end_time: z.coerce.date().optional().nullable(),
  location: z.string().optional().nullable(),
  should_notify: z.boolean().default(true),
});

export const TimelineSchema = BaseTimelineSchema.refine(
  (data) => {
    if (data.start_time && data.end_time) {
      return data.start_time < data.end_time;
    }
    return true;
  },
  {
    message: "End time must be after start time",
    path: ["end_time"],
  }
);