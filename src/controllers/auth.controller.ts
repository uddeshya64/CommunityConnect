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


      const validatedData =
      VerifyEmailOtpSchema.parse(req.body);



      if(validatedData.context==="REGISTER"){


        const tokens =
        await AuthService.verifyRegisterOtp(
          validatedData.name || "User",
          validatedData.email,
          validatedData.otp
        );


        return res.status(201).json({

          success:true,
          ...tokens,

          message:
          "Registration successful",

        });


      }



      const resetToken =
      await AuthService.verifyResetOtp(
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


      const {
        email,
        password
      } = req.body;



      if(!email || !password){

        return res.status(400).json({

          success:false,

          error:
          "Email and password are required",

        });

      }



      const tokens =
      await AuthService.loginWithEmail(
        email,
        password
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
  // GOOGLE OAUTH LOGIN
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

          message:
          "Google authentication failed",

        });

      }



     const tokens =
await AuthService.loginWithGoogle(user);
console.log('Tokens:', tokens);


     const redirectUrl =
      new URL(
        `${config.FRONTEND_URL}/home`
      );
      redirectUrl.searchParams.set(
        "accessToken",
        tokens.accessToken
      );


      redirectUrl.searchParams.set(
        "refreshToken",
        tokens.refreshToken
      );

redirectUrl.searchParams.set(
  "name",
  user.name
);


redirectUrl.searchParams.set(
  "email",
  user.email
);


      return res.redirect(
        redirectUrl.toString()
      );



    }
    catch(error:any){


      console.error(
        "Google Login Error:",
        error
      );


      return res.status(500).json({

        success:false,

        message:
        "Google authentication failed",

      });

    }

  },




  // POST /api/auth/reset-password

  async resetPassword(
    req:Request,
    res:Response
  ){

    try{


      const {
        token,
        newPassword

      } =
      ResetPasswordSchema.parse(
        req.body
      );



      await AuthService.resetPassword(
        token,
        newPassword
      );



      return res.json({

        success:true,

        message:
        "Password updated successfully. Please login.",

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


      const {
        refreshToken
      } = req.body;



      if(!refreshToken){

        return res.status(400).json({

          success:false,

          error:
          "Refresh token is required",

        });

      }



      const token =
      await SessionService.refreshSession(
        refreshToken
      );



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



      await SessionService.logout(
        req.user.sessionId
      );



      return res.status(200).json({

        success:true,

        message:
        "Logged out successfully",

      });


    }
    catch(error:any){

      return res.status(400).json({

        success:false,

        error:error.message,

      });

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
        req.user.id
      );



      return res.status(200).json({

        success:true,

        message:
        "Logged out from all devices",

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
        req.user.id,
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