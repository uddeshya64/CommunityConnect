import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { config } from "../config/env";
import { EmailService } from "./email.service";
import { SessionService } from "./session.service";

if (
  !config.JWT_SECRET ||
  !config.RESET_TOKEN_SECRET
) {
  console.error(
    "❌ FATAL ERROR: JWT_SECRET or RESET_SECRET is missing in .env"
  );

  process.exit(1);
}

const prisma = new PrismaClient();

// Temporary in-memory OTP store
const otpStore: Record<string, any> = {};

export class AuthService {
  // =====================================================
  // SEND OTP
  // =====================================================

  static async sendOtp(
    email: string,
    password?: string,
    context: "REGISTER" | "RESET" = "REGISTER"
  ) {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: {
        email,
      },
    });

    // -------------------------------------------------
    // REGISTER OTP
    // -------------------------------------------------

    if (context === "REGISTER") {
      // User already exists
      if (user) {
        throw new Error(
          "User already exists. Please login."
        );
      }

      // Password required for normal registration
      if (!password) {
        throw new Error(
          "Password is required for registration."
        );
      }
    }

    // -------------------------------------------------
    // RESET PASSWORD OTP
    // -------------------------------------------------

    if (context === "RESET" && !user) {
      // Don't reveal whether email exists
      return {
        message: "OTP sent successfully",
      };
    }

    // -------------------------------------------------
    // GENERATE OTP
    // -------------------------------------------------

    const otp = Math.floor(
      100000 + Math.random() * 900000
    ).toString();

    // Hash OTP before storing
    const hash = await bcrypt.hash(
      otp,
      10
    );

    // Hash password if provided
    const passwordHash = password
      ? await bcrypt.hash(password, 10)
      : undefined;

    // Store OTP data
    otpStore[email] = {
      hash,
      passwordHash,
      context,
      expires:
        Date.now() +
        10 * 60 * 1000,
    };

    // Send OTP email
    await EmailService.sendOtpEmail(
      email,
      otp
    );

    return {
      message: "OTP sent successfully",
    };
  }

  // =====================================================
  // VERIFY REGISTER OTP
  // =====================================================

  static async verifyRegisterOtp(
    name: string,
    email: string,
    otp: string
  ) {
    // Get OTP data
    const data = otpStore[email];

    // Check OTP exists
    if (!data) {
      throw new Error(
        "OTP expired or invalid"
      );
    }

    // Check OTP context
    if (data.context !== "REGISTER") {
      throw new Error(
        "Invalid OTP context"
      );
    }

    // Check OTP expiration
    if (
      Date.now() >
      data.expires
    ) {
      delete otpStore[email];

      throw new Error(
        "OTP expired or invalid"
      );
    }

    // Verify OTP
    const isValid =
      await bcrypt.compare(
        otp,
        data.hash
      );

    if (!isValid) {
      throw new Error(
        "Invalid OTP"
      );
    }

    // Create user
    const user =
      await prisma.user.create({
        data: {
          name,
          email,
          password_hash:
            data.passwordHash,
          created_at: new Date(),
        },
      });

    // Delete OTP after successful registration
    delete otpStore[email];

    // Create login session
    return await SessionService.createSession(
      user
    );
  }

  // =====================================================
  // VERIFY RESET OTP
  // =====================================================

  static async verifyResetOtp(
    email: string,
    otp: string
  ) {
    // Get OTP data
    const data = otpStore[email];

    // Check OTP exists
    if (!data) {
      throw new Error(
        "OTP expired or invalid"
      );
    }

    // Check context
    if (data.context !== "RESET") {
      throw new Error(
        "Invalid OTP context"
      );
    }

    // Check expiration
    if (
      Date.now() >
      data.expires
    ) {
      delete otpStore[email];

      throw new Error(
        "OTP expired or invalid"
      );
    }

    // Verify OTP
    const isValid =
      await bcrypt.compare(
        otp,
        data.hash
      );

    if (!isValid) {
      throw new Error(
        "Invalid OTP"
      );
    }

    // Delete OTP after successful verification
    delete otpStore[email];

    // Create reset token
    return jwt.sign(
      {
        id: email,
        purpose: "reset_pass",
      },
      config.RESET_TOKEN_SECRET!,
      {
        expiresIn: "5m",
      }
    );
  }

  // =====================================================
  // RESET PASSWORD
  // =====================================================

  static async resetPassword(
    token: string,
    newPassword: string
  ) {
    let decoded: any;

    // Verify reset token
    try {
      decoded = jwt.verify(
        token,
        config.RESET_TOKEN_SECRET!
      );
    } catch {
      throw new Error(
        "Invalid or expired token"
      );
    }

    // Check token purpose
    if (
      decoded.purpose !==
      "reset_pass"
    ) {
      throw new Error(
        "Invalid token"
      );
    }

    // Hash new password
    const hash =
      await bcrypt.hash(
        newPassword,
        10
      );

    // Update password
    await prisma.user.update({
      where: {
        email: decoded.id,
      },

      data: {
        password_hash: hash,
      },
    });

    return {
      message:
        "Password reset successfully",
    };
  }

  // =====================================================
  // LOGIN WITH EMAIL AND PASSWORD
  // =====================================================

  static async loginWithEmail(
    email: string,
    password: string
  ) {
    // Find user
    const user =
      await prisma.user.findUnique({
        where: {
          email,
        },
      });

    // User doesn't exist
    if (!user) {
      throw new Error(
        "Invalid email or password"
      );
    }

    // Google-only user
    // doesn't have password
    if (!user.password_hash) {
      throw new Error(
        "Invalid email or password"
      );
    }

    // Verify password
    const isPasswordValid =
      await bcrypt.compare(
        password,
        user.password_hash
      );

    if (!isPasswordValid) {
      throw new Error(
        "Invalid email or password"
      );
    }

    // Create session
    const session = await SessionService.createSession(
      user
    );
    return {
      ...session,
      user_settings: user.user_settings || {},
    };
  }

  // =====================================================
  // LOGIN WITH GOOGLE
  // =====================================================

  static async loginWithGoogle(
    user: any
  ) {
    // Passport should provide
    // the authenticated user
    if (!user) {
      throw new Error(
        "Google authentication failed"
      );
    }

    // Create normal application session
    // using the same session logic
    // as email/password login.
    return await SessionService.createSession(
      user
    );
  }

  // =====================================================
  // CHANGE PASSWORD FOR AUTHENTICATED USER
  // =====================================================

  static async changePassword(
    userId: number,
    currentPassword?: string,
    newPassword?: string
  ) {
    if (!newPassword || newPassword.length < 8) {
      throw new Error(
        "New password must be at least 8 characters long."
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error("User not found.");
    }

    // If user already has a password, verify currentPassword
    if (user.password_hash) {
      if (!currentPassword) {
        throw new Error(
          "Current password is required."
        );
      }
      const isMatch = await bcrypt.compare(
        currentPassword,
        user.password_hash
      );
      if (!isMatch) {
        throw new Error(
          "Current password is incorrect."
        );
      }
    }

    const hash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: hash },
    });

    return {
      message: "Password updated successfully.",
    };
  }
}