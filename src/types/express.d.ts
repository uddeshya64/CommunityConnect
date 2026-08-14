import "express";
import "passport";

declare global {
  namespace Express {
    interface User {
      id: any;
      email?: string;
      sessionId?: string;
    }
  }
}

export {};