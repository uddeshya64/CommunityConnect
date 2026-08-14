import { PrismaClient } from "@prisma/client";
import { RecommendationService } from "./recommendation.service";

const prisma = new PrismaClient();

export class RegistrationService {

  static async submitRegistrationForm(
    registrationId: number,
    userId: number,
    formResponses: Record<string, any>
  ) {

    // Check registration exists
    const registration = await prisma.registration.findUnique({
      where: {
        id: registrationId
      }
    });

    if (!registration) {
      throw new Error("Registration not found.");
    }

    // Ensure user owns this registration
    if (registration.user_id !== userId) {
      throw new Error("Unauthorized.");
    }

    // Permanent profile fields
    const {
      name,
      phone,
      linkedin,
      github,
      profession,
      ...customFields
    } = formResponses;

    return await prisma.$transaction(async (tx) => {

      // Update User Profile
      await tx.user.update({
        where: {
          id: userId
        },
        data: {
          ...(name && { name }),
          ...(phone && { phone }),
          ...(linkedin && { linkedin }),
          ...(github && { github }),
          ...(profession && { profession })
        }
      });

      // Save event specific answers
      const updatedRegistration = await tx.registration.update({
        where: {
          id: registrationId
        },
        data: {
          form_responses: customFields
        }
      });

      // Automatically generate ML Personal Agenda recommendations
      RecommendationService.generatePersonalAgenda(userId, updatedRegistration.event_id).catch(err => {
        console.error(`[AGENDA_RECOMMENDATION_ERROR] Failed to generate agenda for user ${userId} and event ${updatedRegistration.event_id}:`, err);
      });

      return updatedRegistration;

    });

  }

}