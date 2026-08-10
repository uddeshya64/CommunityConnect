import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authLimiter } from "../middlewares/security";
import { authenticate } from "../middlewares/auth.middleware";
import passport from "passport";

const router = Router();

// ---------------- Registration ----------------

router.post(
  "/register/init",
  authLimiter,
  AuthController.initiateEmailReg
);

router.post(
  "/register/verify",
  authLimiter,
  AuthController.verifyEmailReg
);

// ---------------- Login ----------------

router.post(
  "/login",
  authLimiter,
  AuthController.login
);

// ---------------- Refresh Token ----------------

router.post(
  "/refresh",
  AuthController.refresh
);

// ---------------- Logout ----------------

router.post(
  "/logout",
  authenticate,
  AuthController.logout
);

// ---------------- Logout All Devices ----------------

router.post(
  "/logout-all",
  authenticate,
  AuthController.logoutAll
);

// ---------------- Reset Password ----------------

router.post(
  "/reset-password",
  authLimiter,
  AuthController.resetPassword
);

// ---------------- Change Password ----------------

router.post(
  "/change-password",
  authenticate,
  AuthController.changePassword
);


// =====================================================
// GOOGLE OAUTH
// =====================================================

// Step 1:
// Frontend redirects here
//
// GET /api/auth/google

router.get(
  "/google",
  passport.authenticate("google", {
    scope: [
      "profile",
      "email",
    ],
    session: false,
  })
);

// Step 2:
// Google redirects here after login
//
// GET /api/auth/google/callback

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect:
      "/api/auth/google/failure",
  }),
  AuthController.googleLogin
);

// Google OAuth failure
router.get(
  "/google/failure",
  (req, res) => {
    res.status(401).json({
      success: false,
      message:
        "Google authentication failed",
    });
  }
);

export default router;