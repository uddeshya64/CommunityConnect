
controller_path = "src/controllers/agenda.controller.ts"
with open(controller_path, "r", encoding="utf-8") as f:
    text = f.read()

# Add import prisma from "../config/prisma";
if "import prisma from" not in text:
    text = "import prisma from \"../config/prisma\";\n" + text

# Replace stale userSettings lookup in getUserAgenda & generateAgenda
old_user_check = """      const user = (req as any).user;
      const userSettings = (user?.user_settings as any) || {};
      const isCalendarConnected = userSettings.calendar_sync_enabled === true && !!userSettings.google_access_token;"""

new_user_check = """      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { user_settings: true }
      });
      const userSettings = (dbUser?.user_settings as any) || {};
      const isCalendarConnected = userSettings.calendar_sync_enabled === true && !!userSettings.google_access_token;"""

text = text.replace(old_user_check, new_user_check)

with open(controller_path, "w", encoding="utf-8") as f:
    f.write(text)

print("Updated agenda.controller.ts cleanly with fresh Prisma DB query")

