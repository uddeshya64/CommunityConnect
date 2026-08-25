import passport from "passport";
import {
  Strategy as GoogleStrategy,
  Profile,
} from "passport-google-oauth20";

import prisma from "./prisma";
import config from "./config";

passport.use(
  new GoogleStrategy(
    {
      clientID: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      callbackURL: config.GOOGLE_CALLBACK_URL,
      passReqToCallback: true
    },

    async (
      req: any,
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: (error: any, user?: any) => void
    ) => {
      try {
        const email = profile.emails?.[0]?.value;
        const googleId = profile.id;
        const name = profile.displayName || "Google User";

        // Parse OAuth state parameter to extract target userId, returnUrl, & isCalendarRequest
        let targetUserId: number | null = null;
        let returnUrl: string | null = null;
        let isCalendarRequest = false;

        if (req.query?.state) {
          try {
            const parsedState = JSON.parse(req.query.state as string);
            if (parsedState.userId) targetUserId = Number(parsedState.userId);
            if (parsedState.returnUrl) returnUrl = parsedState.returnUrl;
            if (typeof parsedState.isCalendarRequest === "boolean") {
              isCalendarRequest = parsedState.isCalendarRequest;
            }
          } catch {
            if (typeof req.query.state === "string" && req.query.state.startsWith("http")) {
              returnUrl = req.query.state;
            }
          }
        }

        let user = null;

        // 1. If explicit targetUserId passed from logged-in session, use it!
        if (targetUserId) {
          user = await prisma.user.findUnique({ where: { id: targetUserId } });
        }

        // 2. Otherwise fallback to email lookup
        if (!user && email) {
          user = await prisma.user.findUnique({ where: { email } });
        }

        // 3. Otherwise fallback to google_id lookup
        if (!user && googleId) {
          user = await prisma.user.findUnique({ where: { google_id: googleId } });
        }

        if (user) {
          const existingSettings = (user.user_settings as any) || {};
          
          // Only enable calendar sync and save access token if calendar permissions were explicitly requested
          const updatedSettings = isCalendarRequest ? {
            ...existingSettings,
            google_access_token: accessToken,
            ...(refreshToken && { google_refresh_token: refreshToken }),
            calendar_sync_enabled: true
          } : {
            ...existingSettings,
            calendar_sync_enabled: existingSettings.calendar_sync_enabled === true
          };

          const updateData: any = {
            user_settings: updatedSettings
          };

          // Only set google_id if the user doesn't already have one,
          // AND no other user account in the database is already using this google_id.
          if (!user.google_id && googleId) {
            const existingGoogleUser = await prisma.user.findUnique({
              where: { google_id: googleId }
            });
            if (!existingGoogleUser) {
              updateData.google_id = googleId;
            }
          }

          user = await prisma.user.update({
            where: { id: user.id },
            data: updateData
          });

          return done(null, user);
        }

        if (!email) {
          return done(new Error("Google account does not have an email address"));
        }

        // Create new Google user (calendar sync disabled by default on basic signup)
        user = await prisma.user.create({
          data: {
            name,
            email,
            google_id: googleId,
            avatar_url: null,
            password_hash: null,
            user_settings: isCalendarRequest ? {
              google_access_token: accessToken,
              ...(refreshToken && { google_refresh_token: refreshToken }),
              calendar_sync_enabled: true
            } : {
              calendar_sync_enabled: false
            }
          },
        });

        return done(null, user);
      } catch (error) {
        console.error("Google OAuth Error:", error);
        return done(error);
      }
    }
  )
);

export default passport;
