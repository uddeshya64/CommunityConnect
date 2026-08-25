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
    },

    async (
      accessToken: string,
      refreshToken: string,
      profile: Profile,
      done: (error: any, user?: any) => void
    ) => {
      try {
        const email =
          profile.emails?.[0]?.value;

        const googleId = profile.id;

        const name =
          profile.displayName ||
          "Google User";

        const avatarUrl =
          profile.photos?.[0]?.value ||
          null;

        if (!email) {
          return done(
            new Error(
              "Google account does not have an email address"
            )
          );
        }

        // Check if user already exists
        let user = await prisma.user.findUnique({
          where: {
            email,
          },
        });

       if (user) {

  // Link Google account if google_id is missing
  // Do not update existing profile avatar
  if (!user.google_id) {

    user = await prisma.user.update({

      where: {
        id: user.id,
      },

      data: {
        google_id: googleId,
      },

    });

  }


  return done(null, user);

}
const userSettings = {
  theme: "dark"
}
        // Create new Google user
        user = await prisma.user.create({
          data: {
            name,
            email,
            google_id: googleId,
            avatar_url: null,
            user_settings:userSettings,


            // Google users don't need password
            password_hash: null,
          },
        });

        return done(null, user);
      } catch (error) {
        console.error(
          "Google OAuth Error:",
          error
        );

        return done(error);
      }
    }
  )
);

export default passport;