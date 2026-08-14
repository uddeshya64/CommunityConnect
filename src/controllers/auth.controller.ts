import { Request, Response } from "express";

import { AuthService } from "../services/auth.service";

import {
  VerifyEmailOtpSchema,
  SendOtpSchema,
  ResetPasswordSchema,
} from "../validation/auth.validation";

import { SessionService } from "../services/session.service";

import { config } from "../config/env";
import { JwtUtil } from "../utils/jwt";

export const AuthController = {
  // POST /api/auth/email/init
  async initiateEmailReg(
    req: Request,
    res: Response
  ) {
    try {
      const {
        email,
        password,
        context = "REGISTER",
      } = SendOtpSchema.parse(req.body);

      if (context === "REGISTER" && !password) {
        return res.status(400).json({
          success:false,
          error:"Password is required for registration",
        });
      }

      await AuthService.sendOtp(
        email,
        password,
        context
      );

      return res.status(200).json({
        success:true,
        message:"Verification code sent to email",
      });
    } catch(error:any){
      return res.status(
        error.name==="ZodError" ? 400 : 500
      )
      .json({
        success:false,
        error:error.message,
      });
    }
  },

  // POST /api/auth/email/verify
  async verifyEmailReg(
    req:Request,
    res:Response
  ){
    try{
      const validatedData = VerifyEmailOtpSchema.parse(req.body);

      if(validatedData.context==="REGISTER"){
        const tokens = await AuthService.verifyRegisterOtp(
          validatedData.name || "User",
          validatedData.email,
          validatedData.otp
        );

        return res.status(201).json({
          success:true,
          ...tokens,
          message: "Registration successful",
        });
      }

      const resetToken = await AuthService.verifyResetOtp(
        validatedData.email,
        validatedData.otp
      );

      return res.status(200).json({
        success:true,
        token:resetToken,
        message:"OTP verified",
      });
    }
    catch(error:any){
      return res.status(400).json({
        success:false,
        error:error.message,
      });
    }
  },

  // POST /api/auth/login
  async login(
    req:Request,
    res:Response
  ){
    try{
      const { email, password } = req.body;

      if(!email || !password){
        return res.status(400).json({
          success:false,
          error: "Email and password are required",
        });
      }

      const tokens = await AuthService.loginWithEmail(
        email,
        password,
        {
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"]
        }
      );

      return res.status(200).json({
        success:true,
        ...tokens,
      });
    }
    catch(error:any){
      return res.status(401).json({
        success:false,
        error:error.message,
      });
    }
  },

  // ====================================
  // GOOGLE OAUTH LOGIN & CALLBACK
  // ====================================

  // GET /api/auth/google/callback
  async googleLogin(
    req:Request,
    res:Response
  ){
    try{
      const user:any = req.user ? req.user : null;
      console.log("user:", user);

      if(!user){
        return res.status(401).json({
          success:false,
          message: "Google authentication failed",
        });
      }

      const tokens = await AuthService.loginWithGoogle(user);
      console.log('Tokens:', tokens);

      let returnUrlToUse: string | null = null;
      if (req.query?.state) {
        try {
          const parsedState = JSON.parse(req.query.state as string);
          if (parsedState && parsedState.returnUrl) {
            returnUrlToUse = parsedState.returnUrl;
          }
        } catch {
          if (typeof req.query.state === "string" && req.query.state.startsWith("http")) {
            returnUrlToUse = req.query.state;
          }
        }
      }

      const tokens = await AuthService.loginWithGoogle(
        user,
        {
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.headers["user-agent"]
        }
      );

      const redirectUrl = new URL(`${config.FRONTEND_URL}/oauth-success`);
      redirectUrl.searchParams.set("accessToken", tokens.accessToken);
      redirectUrl.searchParams.set("refreshToken", tokens.refreshToken);
      redirectUrl.searchParams.set("name", user.name || "");
      redirectUrl.searchParams.set("email", user.email || "");

      if (returnUrlToUse && returnUrlToUse.startsWith("http")) {
        redirectUrl.searchParams.set("returnUrl", returnUrlToUse);
      }

      return res.redirect(redirectUrl.toString());
    }
    catch(error:any){
      console.error("Google Login Error:", error);
      return res.status(500).json({
        success:false,
        message: "Google authentication failed",
      });
    }
  },

  // POST /api/auth/reset-password
  async resetPassword(
    req:Request,
    res:Response
  ){
    try{
      const { token, newPassword } = ResetPasswordSchema.parse(req.body);
      await AuthService.resetPassword(token, newPassword);

      return res.json({
        success:true,
        message: "Password updated successfully. Please login.",
      });
    }
    catch(error:any){
      return res.status(400).json({
        success:false,
        error:error.message,
      });
    }
  },

  // POST /api/auth/refresh
  async refresh(
    req:Request,
    res:Response
  ){
    try{
      const { refreshToken } = req.body;
      if(!refreshToken){
        return res.status(400).json({
          success:false,
          error: "Refresh token is required",
        });
      }
      const token = await SessionService.refreshSession(refreshToken);
      return res.status(200).json({
        success:true,
        ...token,
      });
    }
    catch(error:any){
      return res.status(401).json({
        success:false,
        error:error.message,
      });
    }
  },

  // POST /api/auth/logout
  async logout(
    req:Request,
    res:Response
  ){
    try{
      if(!req.user){
        return res.status(401).json({
          success:false,
          error:"Unauthorized",
        });
      }
      await SessionService.logout((req.user as any).sessionId);
      return res.status(200).json({
        success:true,
        message: "Logged out successfully",
      });
    }
    catch(error:any){
      return res.status(400).json({
        success:false,
        error:error.message,
      });
    }
  },

  // ====================================
  // GET ACTIVE SESSIONS
  // ====================================

  async getSessions(
    req:Request,
    res:Response
  ){
    try{
      if(!req.user){
        return res.status(401).json({ success:false, error:"Unauthorized" });
      }

      const sessions = await SessionService.getSessions(req.user.id);   
      
      const currentSessionId = req.user!.sessionId;

      const formattedSessions = sessions.map(sess => {
        const s: any = sess;
        return {
          id: s.sessionId,
          device: s.device || "Unknown Device",
          browser: s.browser || "Unknown Browser",
          ip: s.ipAddress || "Unknown IP",
          lastActive: s.lastActive,
          isCurrent: s.sessionId === currentSessionId
        };
      });

      return res.status(200).json({
        success:true,
        data: formattedSessions
      });

    }
    catch(error:any){
      return res.status(400).json({ success:false, error:error.message });
    }
  },

  // ====================================
  // REVOKE SPECIFIC SESSION
  // ====================================

  async revokeSession(
    req:Request,
    res:Response
  ){
    try{
      if(!req.user){
        return res.status(401).json({ success:false, error:"Unauthorized" });
      }

      // normalize possible string | string[] from params
      let sessionId = req.params.id as string | string[] | undefined;
      if (Array.isArray(sessionId)) sessionId = sessionId[0];
      if (!sessionId) {
        return res.status(400).json({ success:false, error:"Session ID is required" });
      }

      await SessionService.revokeSession(sessionId, req.user.id);

      return res.status(200).json({
        success:true,
        message: "Session revoked successfully"
      });

    }
    catch(error:any){
      return res.status(400).json({ success:false, error:error.message });
    }
  },

  // POST /api/auth/logout-all
  async logoutAll(
    req:Request,
    res:Response
  ){
    try{
      if(!req.user){
        return res.status(401).json({
          success:false,
          error:"Unauthorized",
        });
      }

      await SessionService.logoutAll(
        req.user.id,
        req.user.sessionId || ""
      );

      return res.status(200).json({
        success:true,
        message: "Logged out from all other devices",
      });
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  },

  // POST /api/auth/change-password
  async changePassword(req: Request, res: Response) {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Unauthorized",
        });
      }
      const { currentPassword, newPassword } = req.body;
      const result = await AuthService.changePassword(
        (req.user as any).id,
        currentPassword,
        newPassword
      );
      return res.status(200).json({
        success: true,
        ...result,
      });
    } catch (error: any) {
      return res.status(400).json({
        success: false,
        error: error.message,
      });
    }
  },
};
