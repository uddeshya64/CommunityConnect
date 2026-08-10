import { Request, Response } from "express";
import { ProfileService } from "../services/profile.service";
import { UpdateProfileSchema } from "../validation/profile.validation";

const getUserId = (req: Request): number => {

  if (!req.user) {
    throw new Error("Unauthorized");
  }

  return req.user.id;
};

export const ProfileController = {

  // GET /profile/me
  async getMyProfile(
    req: Request,
    res: Response
  ) {

    try {

      const profile =
        await ProfileService.getProfile(
          getUserId(req)
        );

      return res.status(200).json({
        success: true,
        data: profile,
      });

    } catch (error: any) {

      return res.status(404).json({
        success: false,
        error: error.message,
      });

    }
  },

  // GET /profile/:id
  async getProfileById(
    req: Request,
    res: Response
  ) {

    try {

      const id = Number(req.params.id);

      if (isNaN(id)) {
        return res.status(400).json({
          success: false,
          error: "Invalid user id",
        });
      }

      const profile =
        await ProfileService.getProfile(id, (req as any).user?.id || 0);

      return res.status(200).json({
        success: true,
        data: profile,
      });

    } catch (error: any) {

      return res.status(404).json({
        success: false,
        error: error.message,
      });

    }
  },

  // PATCH /profile/me
  async updateMyProfile(
    req: Request,
    res: Response
  ) {

    try {

      const validatedData =
        UpdateProfileSchema.parse(req.body);

      const profile =
        await ProfileService.updateProfile(
          getUserId(req),
          validatedData
        );

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
        data: profile,
      });

    } catch (error: any) {

      if (error.name === "ZodError") {

        return res.status(400).json({
          success: false,
          error: error.errors,
        });

      }

      return res.status(500).json({
        success: false,
        error: error.message,
      });

    }
  },

  // GET /profile/me/settings
  async getSettings(req: Request, res: Response) {
    try {
      const settings = await ProfileService.getSettings(getUserId(req));
      return res.status(200).json({
        success: true,
        data: settings,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  // PATCH /profile/me/settings
  async updateSettings(req: Request, res: Response) {
    try {
      const updatedSettings = await ProfileService.updateSettings(
        getUserId(req),
        req.body
      );
      return res.status(200).json({
        success: true,
        message: "Settings updated successfully",
        data: updatedSettings,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },

  // DELETE /profile/me
  async deleteAccount(req: Request, res: Response) {
    try {
      await ProfileService.deleteAccount(getUserId(req));
      return res.status(200).json({
        success: true,
        message: "Account deleted successfully",
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
};