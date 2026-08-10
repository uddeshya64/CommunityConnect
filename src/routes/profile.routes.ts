import { Router } from "express";
import { ProfileController } from "../controllers/profile.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

// Logged in user's profile
router.get(
  "/me",
  authenticate,
  ProfileController.getMyProfile
);

// Update own profile
router.patch(
  "/me",
  authenticate,
  ProfileController.updateMyProfile
);

// Get user settings
router.get(
  "/me/settings",
  authenticate,
  ProfileController.getSettings
);

// Update user settings
router.patch(
  "/me/settings",
  authenticate,
  ProfileController.updateSettings
);

// Delete own account
router.delete(
  "/me",
  authenticate,
  ProfileController.deleteAccount
);

// Public profile by id
router.get(
  "/:id",
  authenticate,
  ProfileController.getProfileById
);

export default router;