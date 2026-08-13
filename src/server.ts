/**
 * This file is the entry point of the backend application.
 * It is responsible for initializing the express app, configuring middleware, setting up routes, and starting the server.
 * 
 * @file server.ts
 * @description Entry point of the backend application.
 * @author Uddeshya Patidar, Anjali, Dipanshu
 * @version 1.0.0
 * @date 2026-07-24
 * @lastModified 2026-07-24
 */

import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import passport from "passport";
import { PrismaClient } from "@prisma/client";

// Passport configuration
import "./config/passport";

// Import Routes
import authRoutes from "./routes/auth.routes";
import profileRoutes from "./routes/profile.routes";
import eventRoutes from "./routes/event.routes";
import teamRoutes from "./routes/team.routes";
import teamDashboardRoutes from "./routes/teamDashboard.routes";
import eventStaffRoutes from "./routes/staffManagement.routes";
import notificationRoutes from "./routes/notification.routes";
import locationRoutes from "./routes/location.routes";
import organizerConfigRoutes from "./routes/organizerConfig.routes";
import imageRoutes from "./routes/image";
import registrationRoutes from "./routes/registeration.routes";
import { EventSchedulerService } from "./services/eventScheduler.service";

import { config } from "./config/env";

// =========================================
// INITIALIZE APP
// =========================================

const app = express();
const prisma = new PrismaClient();

const PORT = Number(config.PORT) || 5000;

// =========================================
// 1. GLOBAL MIDDLEWARE
// =========================================

// Security headers
app.use(helmet());

// =========================================
// CORS
// =========================================

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://192.168.20.39:3001",
  "https://community-connect-frontend-5oe1-beta.vercel.app",
  config.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without origin
      // Example: Postman, mobile apps, curl
      if (!origin) {
        return callback(null, true);
      }

      const cleanOrigin = origin.replace(/\/$/, "");

      if (allowedOrigins.includes(cleanOrigin)) {
        return callback(null, true);
      }

      console.log("❌ Blocked by CORS:", origin);

      return callback(new Error("Not allowed by CORS"));
    },

    credentials: true,

    methods: [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],

    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Upgrade-Insecure-Requests",
    ],
  })
);

// =========================================
// BODY PARSERS
// =========================================

app.use(
  express.json({
    limit: "10kb",
  })
);

app.use(
  express.urlencoded({
    extended: true,
  })
);

// =========================================
// PASSPORT INITIALIZATION
// =========================================

app.use(passport.initialize());

// =========================================
// REQUEST LOGGER
// =========================================

app.use((req, res, next) => {
  console.log(
    `📥 ${req.method} ${req.originalUrl}`
  );

  next();
});

// =========================================
// 2. HEALTH CHECK
// =========================================

app.get(
  "/health",
  (req: Request, res: Response) => {
    res.status(200).json({
      success: true,
      status: "UP",
      timestamp: new Date(),
    });
  }
);

// =========================================
// 3. ROUTE MOUNTING
// =========================================

// =========================================
// AUTH ROUTES
// =========================================

app.use(
  "/api/auth",
  authRoutes
);

// =========================================
// PROFILE ROUTES
// =========================================

app.use(
  "/api/profile",
  profileRoutes
);

// =========================================
// REGISTRATION ROUTES
// =========================================

app.use(
  "/api/registration",
  teamRoutes
);

// =========================================
// TEAM DASHBOARD
// =========================================

app.use(
  "/api/team-dashboard",
  teamDashboardRoutes
);

// =========================================
// NOTIFICATIONS
// =========================================
app.use(
  "/api/notifications",
  notificationRoutes
);

// =========================================
// STAFF MANAGEMENT
// =========================================

// Event-specific staff management
app.use(
  "/api/events/:eventId/manage",
  eventStaffRoutes
);

// Public staff actions
// Example:
// POST /api/staff/accept-invite
app.use(
  "/api/staff",
  eventStaffRoutes
);

// =========================================
// EVENT ROUTES
// =========================================

app.use(
  "/api/events",
  eventRoutes
);

// =========================================
// EVENT STAFF ROUTES
// =========================================

app.use(
  "/api/events/:eventId/staff",
  eventStaffRoutes
);

// =========================================
// ORGANIZER CONFIGURATION
// =========================================

app.use(
  "/api/organizers",
  organizerConfigRoutes
);

// =========================================
// LOCATION ROUTES
// =========================================

app.use(
  "/api/locations",
  locationRoutes
);

// =========================================
// IMAGE UPLOAD ROUTES
// =========================================

app.use(
  "/api/image",
  imageRoutes
);

app.use("/api/registrations", registrationRoutes);

// =========================================
// 4. GLOBAL ERROR HANDLER
// =========================================

app.use(
  (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    console.error(
      "[SERVER_ERROR]",
      err.stack
    );

    const statusCode =
      err.statusCode || 500;

    const message =
      err.message ||
      "Internal Server Error";

    res.status(statusCode).json({
      success: false,
      error: message,

      stack:
        config.NODE_ENV === "development"
          ? err.stack
          : undefined,
    });
  }
);

// =========================================
// 5. SERVER STARTUP
// =========================================

const startServer = async () => {
  try {
    // Connect to database
    await prisma.$connect();

    console.log(
      "✅ Database connected successfully"
    );

    // Start Express server
    app.listen(PORT, () => {
      console.log(
        `🚀 Server running on http://localhost:${PORT}`
      );

      console.log(
        `🛡️ Environment: ${config.NODE_ENV || "development"
        }`
      );

      // Start Event Background Notification Scheduler
      EventSchedulerService.startScheduler();
    });
  } catch (error) {
    console.error(
      "❌ Failed to start server:",
      error
    );

    await prisma.$disconnect();

    process.exit(1);
  }
};

// Start application
startServer();
