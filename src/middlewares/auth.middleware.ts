import { Request, Response, NextFunction } from "express";
import { JwtUtil } from "../utils/jwt";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Access token is required",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = JwtUtil.verifyAccessToken(token);

    // Verify session still exists in DB
    const session = await prisma.userSession.findUnique({
      where: { sessionId: decoded.sessionId }
    });

    if (!session) {
      return res.status(401).json({
        success: false,
        error: "Session has been revoked or logged out",
      });
    }

    req.user = decoded;

    next();
  } catch {
    return res.status(401).json({
      success: false,
      error: "Invalid or expired access token",
    });
  }
};

export const optionalAuthenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.split(" ")[1];

    const decoded = JwtUtil.verifyAccessToken(token);

    const session = await prisma.userSession.findUnique({
      where: { sessionId: decoded.sessionId }
    });

    if (session) {
      req.user = decoded;
    }

    next();
  } catch {
    next();
  }
};