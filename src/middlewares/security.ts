import rateLimit from 'express-rate-limit';

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000000000,
  message: "Too many login attempts, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});