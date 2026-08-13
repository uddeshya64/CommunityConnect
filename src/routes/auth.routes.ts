import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authLimiter } from "../middlewares/security";
import { authenticate } from "../middlewares/auth.middleware";
import passport from "passport";
import jwt from "jsonwebtoken";
import config from "../config/config";

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
// GOOGLE OAUTH - BASIC SIGNUP / LOGIN (IDENTITY ONLY)
// =====================================================

router.get(
  "/google",
  (req, res, next) => {
    const returnUrl = req.query.returnUrl ? String(req.query.returnUrl) : "";
    const token = (req.query.token as string) || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : "");
    let userId: number | null = null;

    if (token) {
      try {
        const decoded: any = jwt.verify(token, config.JWT_SECRET);
        if (decoded && decoded.id) {
          userId = Number(decoded.id);
        }
      } catch (err) {
        console.warn("Could not decode JWT token:", err);
      }
    }

    const stateObj = JSON.stringify({ userId, returnUrl, isCalendarRequest: false });

    passport.authenticate("google", {
      scope: ["profile", "email"],
      session: false,
      state: stateObj
    })(req, res, next);
  }
);

// =====================================================
// GOOGLE OAUTH - EXPLICIT CALENDAR CONNECT (PERMISSIONS)
// =====================================================

router.get(
  "/google/calendar",
  (req, res, next) => {
    const returnUrl = req.query.returnUrl ? String(req.query.returnUrl) : "";
    const token = (req.query.token as string) || (req.headers.authorization ? req.headers.authorization.split(" ")[1] : "");
    let userId: number | null = null;

    if (token) {
      try {
        const decoded: any = jwt.verify(token, config.JWT_SECRET);
        if (decoded && decoded.id) {
          userId = Number(decoded.id);
        }
      } catch (err) {
        console.warn("Could not decode JWT token for Google OAuth linking:", err);
      }
    }

    const stateObj = JSON.stringify({ userId, returnUrl, isCalendarRequest: true });

    passport.authenticate("google", {
      scope: [
        "profile",
        "email",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events"
      ],
      accessType: "offline",
      prompt: "consent",
      session: false,
      state: stateObj
    })(req, res, next);
  }
);

// Step 2:
// Google redirects here after login / calendar authorization

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
