import { PrismaClient, User } from "@prisma/client";
import { JwtUtil } from "../utils/jwt";
import { config } from "../config/env";

const prisma = new PrismaClient();

export class SessionService {

  /**
   * Create a new login session
   */
  static async createSession(user: User, deviceInfo?: { ipAddress?: string, userAgent?: string }) {

    // Generate unique session ID
    const sessionId = JwtUtil.generateSessionId();

    // Generate access token
    const accessToken = JwtUtil.generateAccessToken({
      id: user.id,
      email: user.email,
      sessionId,
    });

    // Generate refresh token
    const refreshToken = JwtUtil.generateRefreshToken({
      id: user.id,
      email: user.email,
      sessionId,
    });

    // Refresh token expiry
    const expiresAt = new Date();
    expiresAt.setDate(
      expiresAt.getDate() +
      config.REFRESH_TOKEN_EXPIRES_DAYS
    );

    // Parse User Agent
    let device = "Desktop";
    let browser = "Unknown";
    
    if (deviceInfo?.userAgent) {
      const ua = deviceInfo.userAgent.toLowerCase();
      if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) {
        device = "Mobile";
      } else if (ua.includes("ipad") || ua.includes("tablet")) {
        device = "Tablet";
      }
      
      if (ua.includes("edg") || ua.includes("edge")) browser = "Edge";
      else if (ua.includes("opr/") || ua.includes("opera")) browser = "Opera";
      else if (ua.includes("chrome")) browser = "Chrome";
      else if (ua.includes("firefox")) browser = "Firefox";
      else if (ua.includes("safari")) browser = "Safari";
    }

    const ipAddress = deviceInfo?.ipAddress || null;

    // Delete any previous sessions from the exact same device, browser, and IP
    // to prevent duplicate sessions from showing up when re-logging in.
    await prisma.userSession.deleteMany({
      where: {
        userId: user.id,
        device,
        browser,
        ipAddress,
      }
    });

    // Store session
    await prisma.userSession.create({
      data: {
        userId: user.id,
        sessionId,
        refreshToken,
        expiresAt,
        ipAddress,
        device,
        browser,
        lastActive: new Date(),
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  /**
   * Generate a new access token using refresh token
   */
  static async refreshSession(refreshToken: string) {

    let payload: any;

    try {
      payload = JwtUtil.verifyRefreshToken(refreshToken);
    } catch {
      throw new Error("Invalid or expired refresh token");
    }

    // Find session
    const session = await prisma.userSession.findUnique({
      where: {
        sessionId: payload.sessionId,
      },
      include: {
        user: true,
      },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    // Ensure refresh token matches database
    if (session.refreshToken !== refreshToken) {
      throw new Error("Invalid refresh token");
    }

    // Check expiry
    if (session.expiresAt < new Date()) {

      await prisma.userSession.deleteMany({
        where: {
          sessionId: payload.sessionId,
        },
      });

      throw new Error("Refresh token expired");
    }

    // Generate new access token
    const accessToken = JwtUtil.generateAccessToken({
      id: session.user.id,
      email: session.user.email,
      sessionId: session.sessionId,
    });

    return {
      accessToken,
    };
  }

  /**
   * Get all active sessions for a user
   */
  static async getSessions(userId: number) {
    return await prisma.userSession.findMany({
      where: {
        userId,
      },
      orderBy: {
        lastActive: 'desc',
      },
    });
  }

  /**
   * Revoke a specific session
   */
  static async revokeSession(sessionId: string, userId: number) {
    const result = await prisma.userSession.deleteMany({
      where: {
        sessionId,
        userId,
      },
    });

    if (result.count === 0) {
      throw new Error("Session not found or unauthorized");
    }

    return { success: true };
  }

  /**
   * Logout current device
   */
  static async logout(sessionId: string) {

  console.log("Deleting session:", sessionId);

  const result = await prisma.userSession.deleteMany({
    where: {
      sessionId,
    },
  });

  console.log(result);

  if (result.count === 0) {
    throw new Error("Already logged out or session not found");
  }

  return {
    success: true,
  };
}
  /**
   * Logout from all other devices
   */
  static async logoutAll(userId: number, currentSessionId: string) {

    await prisma.userSession.deleteMany({
      where: {
        userId,
        sessionId: {
          not: currentSessionId
        }
      },
    });

    return {
      success: true,
    };
  }

}