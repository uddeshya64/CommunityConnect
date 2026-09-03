import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import QRCode from "qrcode";
import crypto from "crypto";
import nodemailer from "nodemailer";
import { PushService } from "./push.service";

const prisma = new PrismaClient();

// ==================================================
// ENVIRONMENT VARIABLES & TRANSPORTER
// ==================================================

const EMAIL_USER = process.env.EMAIL_USER || "click.bait.ud.64@gmail.com";
const EMAIL_PASS = process.env.EMAIL_PASS || "hmyo kpoz immi dbvl";
const SENDER_NAME = process.env.BREVO_SENDER_NAME || "CommunityConnect";
const BREVO_SENDER_NAME = SENDER_NAME;
const BASE_FRONTEND_URL = (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost"))
  ? process.env.FRONTEND_URL
  : "https://community-connect-frontend-5oe1-beta.vercel.app";
const FRONTEND_URL = BASE_FRONTEND_URL.replace(/\/$/, "");

const BREVO_API_URL = process.env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email";
const BREVO_API_KEY = process.env.BREVO_API_KEY || process.env.BREVO_SMTP_KEY || "";
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || EMAIL_USER;

// Create Gmail Nodemailer Transporter
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: EMAIL_USER,
    pass: EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

// ==================================================
// TYPES
// ==================================================

interface BrevoRecipient {
  email: string;
  name?: string;
}

interface BrevoAttachment {
  name: string;
  content: string;
}

interface BrevoEmailPayload {
  sender: {
    name: string;
    email: string;
  };
  to: BrevoRecipient[];
  subject: string;
  textContent?: string;
  htmlContent?: string;
  attachment?: BrevoAttachment[];
}

// ==================================================
// UNIFIED EMAIL SENDER (GMAIL FIRST, BREVO FALLBACK)
// ==================================================

async function sendBrevoEmail(emailData: BrevoEmailPayload) {
  // 1. Primary: Send through Gmail via Nodemailer
  if (EMAIL_USER && EMAIL_PASS) {
    try {
      const recipientEmails = emailData.to.map((r) => r.email).join(", ");
      const mailOptions: nodemailer.SendMailOptions = {
        from: `"${emailData.sender?.name || SENDER_NAME}" <${EMAIL_USER}>`,
        to: recipientEmails,
        subject: emailData.subject,
        text: emailData.textContent,
        html: emailData.htmlContent,
        attachments: emailData.attachment?.map((att) => ({
          filename: att.name,
          content: Buffer.from(att.content, "base64"),
        })),
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`[EMAIL_SENT] Dispatched via ${EMAIL_USER} to: ${recipientEmails} (MessageId: ${info.messageId})`);
      return info;
    } catch (err: any) {
      console.warn(`[GMAIL_WARNING] Failed via Gmail, trying fallback:`, err.message);
    }
  }

  // 2. Secondary: Send through Brevo HTTP API
  if (BREVO_API_KEY && BREVO_SENDER_EMAIL) {
    try {
      const response = await fetch(BREVO_API_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify(emailData),
      });

      if (response.ok) {
        const responseData = await response.json();
        console.log(`[BREVO_SENT] Dispatched via Brevo API:`, responseData);
        return responseData;
      }
    } catch (err: any) {
      console.warn(`[BREVO_WARNING] Failed via Brevo API:`, err.message);
    }
  }

  return { status: "dispatched" };
}

// ==================================================
// EMAIL SERVICE
// ==================================================

export class EmailService {
  // ==================================================
  // 1. SEND OTP EMAIL
  // ==================================================

  static async sendOtpEmail(email: string, otp: string) {
    try {
      const emailData: BrevoEmailPayload = {
        sender: {
          name: BREVO_SENDER_NAME,
          email: BREVO_SENDER_EMAIL,
        },
        to: [{ email }],
        subject: "Your Verification Code",
        textContent: `Your verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nDo not share this code with anyone.`.trim(),
        htmlContent: `
          <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f4f4f5;">
            <div style="max-width: 500px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 12px; border: 1px solid #e4e4e7;">
              <h2 style="color: #18181b;">Verification Code</h2>
              <p style="color: #52525b;">Your verification code is:</p>
              
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #4f46e5; padding: 15px 0;">
                ${otp}
              </div>
              
              <p style="color: #71717a;">This code expires in 10 minutes.</p>
              <p style="color: #71717a;">Do not share this code with anyone.</p>
              
              <hr />
              
              <p style="font-size: 12px; color: #a1a1aa;">
                © ${new Date().getFullYear()} CommunityConnect
              </p>
            </div>
          </div>
        `,
      };

      const response = await sendBrevoEmail(emailData);
      console.log(`[EMAIL_SENT] OTP to: ${email}`, response);

      return response;
    } catch (error) {
      console.error("[EMAIL_ERROR] Failed to send OTP email:", error);
      throw new Error("Failed to send verification email. Please try again.");
    }
  }

  // ==================================================
  // 2. SEND TEAM INVITATION
  // ==================================================

  static async sendTeamInvite(email: string, teamName: string, magicLink: string) {
    try {
      const emailData: BrevoEmailPayload = {
        sender: {
          name: BREVO_SENDER_NAME,
          email: BREVO_SENDER_EMAIL,
        },
        to: [{ email }],
        subject: `You have been invited to join ${teamName}!`,
        textContent: `You have been invited to join the team ${teamName}.\n\nClick the link below to join the team:\n\n${magicLink}\n\nIf the link does not work, copy and paste the URL into your browser.`.trim(),
        htmlContent: `
          <div style="font-family: Arial, sans-serif; padding: 40px 20px; background-color: #f4f4f5;">
            <div style="max-width: 550px; margin: 0 auto; background-color: #ffffff; padding: 32px; border-radius: 16px; border: 1px solid #e4e4e7;">
              <h2 style="color: #18181b; margin-bottom: 15px;">Team Invitation</h2>
              
              <p style="color: #52525b; font-size: 15px; line-height: 1.6;">
                You have been invited to join the team <strong>${teamName}</strong>.
              </p>
              
              <div style="text-align: center; margin: 30px 0;">
                <a href="${magicLink}" style="display: inline-block; padding: 12px 24px; background-color: #4f46e5; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600;">
                  Accept Invitation
                </a>
              </div>
              
              <p style="color: #71717a; font-size: 13px;">
                If the button does not work, copy and paste the following link into your browser:
              </p>
              
              <p style="color: #4f46e5; font-size: 13px; word-break: break-all;">
                ${magicLink}
              </p>
              
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 25px 0;" />
              
              <p style="font-size: 12px; color: #a1a1aa; text-align: center;">
                © ${new Date().getFullYear()} CommunityConnect. All rights reserved.
              </p>
            </div>
          </div>
        `,
      };

      const response = await sendBrevoEmail(emailData);
      console.log(`[EMAIL_SENT] Team invite to: ${email}`, response);

      return response;
    } catch (error) {
      console.error("[EMAIL_ERROR] Failed to send team invite:", error);
      // Do not throw. Invite API will continue.
    }
  }

  // ==================================================
  // 3. SEND REGISTRATION CONFIRMATION EMAIL
  // Includes QR Code Attachment
  // ==================================================

  static async sendRegistrationConfirmationEmail(registrationId: number) {
    try {
      // --------------------------------------------------
      // GET REGISTRATION
      // --------------------------------------------------
      const reg = await prisma.registration.findUnique({
        where: { id: registrationId },
        include: {
          user: true,
          event: true,
          team: true,
        },
      });

      if (!reg) {
        console.error(`[EMAIL_ERROR] Registration not found for ID: ${registrationId}`);
        return;
      }

      // --------------------------------------------------
      // ENSURE TICKET CODE
      // --------------------------------------------------
      let ticketCode = reg.ticket_code;

      if (!ticketCode) {
        ticketCode = `cc_tck_${crypto.randomBytes(12).toString("hex")}`;
        await prisma.registration.update({
          where: { id: reg.id },
          data: { ticket_code: ticketCode },
        });
      }

      // --------------------------------------------------
      // GENERATE QR CODE
      // --------------------------------------------------
      const qrBuffer = await QRCode.toBuffer(ticketCode, {
        margin: 1,
        color: {
          dark: "#18181b",
          light: "#ffffff",
        },
      });

      // --------------------------------------------------
      // FORMAT EVENT DATE
      // --------------------------------------------------
      const formattedDate = new Date(reg.event.start_date).toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      });

      const eventUrl = reg.team_id
        ? `${FRONTEND_URL}/dashboard/team/${reg.team_id}`
        : `${FRONTEND_URL}/events/${reg.event.id}`;

      // --------------------------------------------------
      // CREATE EMAIL PAYLOAD
      // --------------------------------------------------
      const emailData: BrevoEmailPayload = {
        sender: {
          name: BREVO_SENDER_NAME,
          email: BREVO_SENDER_EMAIL,
        },
        to: [
          {
            email: reg.user.email,
            name: reg.user.name,
          },
        ],
        subject: `Your Registration for ${reg.event.title} is Confirmed!`,

        // --------------------------------------------------
        // TEXT CONTENT
        // --------------------------------------------------
        textContent: `
Hi ${reg.user.name},

Your registration for ${reg.event.title} is confirmed!

Event:
${reg.event.title}

Date:
${formattedDate}

${reg.event.location ? `Location:\n${reg.event.location}` : ""}

Your ticket code:
${ticketCode}

View Event:
${eventUrl}

Please keep this email and present your QR code ticket at the entrance.

Thank you,

CommunityConnect
        `.trim(),

        // --------------------------------------------------
        // HTML CONTENT
        // --------------------------------------------------
        htmlContent: `
          <div style="background-color: #f4f4f5; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
            <div style="max-width: 550px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
              
              <!-- Top Accent -->
              <div style="height: 8px; background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #f43f5e 100%);"></div>
              
              <div style="padding: 32px 24px;">
                <!-- Brand -->
                <div style="margin-bottom: 24px;">
                  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                    <tr>
                      <td style="vertical-align: middle; padding-right: 8px;">
                        <div style="width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg, #4f46e5, #7c3aed);"></div>
                      </td>
                      <td style="vertical-align: middle;">
                        <span style="font-size: 18px; font-weight: 800; color: #18181b; letter-spacing: -0.5px;">
                          CommunityConnect
                        </span>
                      </td>
                    </tr>
                  </table>
                </div>

                <!-- Main Message -->
                <h2 style="font-size: 24px; font-weight: 800; color: #18181b; margin: 0 0 8px 0; line-height: 1.2;">
                  Your Ticket is Confirmed! 🎉
                </h2>

                <p style="font-size: 15px; color: #71717a; margin: 0 0 28px 0; line-height: 1.5;">
                  Hi ${reg.user.name}, your registration is complete. We've generated your entry ticket for the event. See the ticket details below.
                </p>

                <!-- Ticket Card -->
                <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 28px;">
                  <!-- Event Title -->
                  <h3 style="font-size: 20px; font-weight: 800; color: #18181b; margin: 0 0 12px 0; line-height: 1.3;">
                    ${reg.event.title}
                  </h3>

                  <!-- Badges -->
                  <div style="margin-bottom: 20px;">
                    <span style="display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 9999px; background-color: #e0e7ff; color: #4338ca; text-transform: capitalize;">
                      ${reg.event.mode}
                    </span>
                    ${reg.team ? `
                    <span style="display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 9999px; background-color: #f1f5f9; color: #334155; margin-left: 6px;">
                      Team: ${reg.team.name}
                    </span>
                    ` : ""}
                  </div>

                  <!-- Details -->
                  <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
                    <tr>
                      <td style="padding-bottom: 10px; width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">
                        Attendee
                      </td>
                      <td style="padding-bottom: 10px; font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">
                        ${reg.user.name}
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-bottom: 10px; width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">
                        Date & Time
                      </td>
                      <td style="padding-bottom: 10px; font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">
                        ${formattedDate}
                      </td>
                    </tr>
                    ${reg.event.location ? `
                    <tr>
                      <td style="width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">
                        Location
                      </td>
                      <td style="font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">
                        ${reg.event.location}
                      </td>
                    </tr>
                    ` : ""}
                  </table>

                  <!-- Separator -->
                  <div style="border-top: 2px dashed #e2e8f0; height: 1px; margin: 24px 0;"></div>

                  <!-- QR Information -->
                  <div style="text-align: center; padding-top: 8px;">
                    <div style="display: inline-block; padding: 12px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px;">
                      <p style="margin: 0; font-size: 14px; color: #71717a;">
                        Your QR ticket is attached to this email.
                      </p>
                    </div>
                    <div style="margin-top: 14px;">
                      <span style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">
                        Ticket Code
                      </span>
                    </div>
                    <div style="margin-top: 4px;">
                      <span style="font-family: Consolas, Monaco, monospace; font-size: 13px; font-weight: 700; color: #1e293b; background-color: #f1f5f9; padding: 4px 10px; border-radius: 6px; border: 1px solid #e2e8f0; display: inline-block;">
                        ${ticketCode}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- CTA -->
                <div style="text-align: center; margin-bottom: 32px;">
                  <a href="${eventUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #ffffff; font-weight: 700; font-size: 15px; text-decoration: none; border-radius: 9999px;">
                    View Event Dashboard
                  </a>
                </div>

                <!-- Guidelines -->
                <div style="background-color: #fef08a; border-left: 4px solid #eab308; padding: 12px 16px; border-radius: 6px; margin-bottom: 28px;">
                  <p style="margin: 0; font-size: 13px; color: #854d0e; font-weight: 500; line-height: 1.4;">
                    <strong>Important:</strong> Please keep this email handy and present the attached QR code on your mobile phone for check-in at the entrance.
                  </p>
                </div>

                <!-- Footer -->
                <div style="text-align: center; border-top: 1px solid #e4e4e7; padding-top: 24px;">
                  <p style="font-size: 13px; color: #a1a1aa; margin: 0 0 6px 0;">
                    Need assistance? Contact the organizer team via the platform.
                  </p>
                  <p style="font-size: 12px; color: #d4d4d8; margin: 0;">
                    &copy; ${new Date().getFullYear()} CommunityConnect. All rights reserved.
                  </p>
                </div>
              </div>
            </div>
          </div>
        `,

        // --------------------------------------------------
        // QR CODE ATTACHMENT
        // --------------------------------------------------
        attachment: [
          {
            name: "ticket-qr.png",
            content: qrBuffer.toString("base64"),
          },
        ],
      };

      // --------------------------------------------------
      // SEND EMAIL THROUGH GMAIL / BREVO
      // --------------------------------------------------
      const response = await sendBrevoEmail(emailData);

      // --------------------------------------------------
      // SEND NATIVE PUSH NOTIFICATION (PC & PHONE PWA)
      // --------------------------------------------------
      PushService.sendPushToUser(reg.user_id, {
        title: "Registration Confirmed! 🎉",
        body: `You're all set for "${reg.event.title}". Tap to view your entry pass & QR ticket.`,
        url: `/events/${reg.event_id}`,
        tag: `ticket-${reg.id}`,
        actions: [{ action: "open", title: "View Ticket" }],
      }).catch((err) => {
        console.error(`[PUSH_ERROR] Registration push failed for user ${reg.user_id}:`, err.message);
      });

      console.log(`[EMAIL_SENT] Registration confirmation sent to: ${reg.user.email}`, {
        registrationId,
        ticketCode,
        response,
      });

      return response;
    } catch (error) {
      console.error("[EMAIL_ERROR] Failed to send registration confirmation email:", error);
      // Do not throw. Registration should not fail because confirmation email failed.
    }
  }
}








// import nodemailer from "nodemailer";
// import { env } from '../env/env';
// import { PrismaClient } from '@prisma/client';
// import QRCode from 'qrcode';
// import crypto from 'crypto';


// const prisma = new PrismaClient();

// // // --- EMAIL TRANSPORTER SETUP ---
// // const transporter = nodemailer.createTransport({
// //   host: "smtp-relay.brevo.com",
// //   port: 587,
// //   secure: false,
// //   auth: {
// //     user: env.BREVO_SMTP_USER,
// //     pass: env.BREVO_SMTP_KEY,
// //   },
// //   connectionTimeout: 20000,
// //   greetingTimeout: 20000,
// //   socketTimeout: 20000,
// // });
// // const transporter = nodemailer.createTransport({
// //   host: "smtp.gmail.com",
// //   port: 587,           // Use 587 instead of the default 465
// //   secure: false,       // false for 587, it will upgrade to TLS automatically
// //   auth: {
// //     user: env.EMAIL_USER,
// //     pass: env.EMAIL_PASS,
// //   },
// //   // 👇 THE RENDER FIX: Give the server more time to complete the handshake
// //   connectionTimeout: 20000, // 20 seconds
// //   greetingTimeout: 20000,
// //   socketTimeout: 20000,
// //   // 👇 Optional but helps bypass strict cloud firewalls
// //   tls: {
// //     rejectUnauthorized: false 
// //   }
// // });

// export class EmailService {
  
//   // 1. Send OTP Email (Used by AuthService)
//   static async sendOtpEmail(email: string, otp: string) {
//     try {
//       await transporter.sendMail({
//         from: `"${process.env.BREVO_SENDER_NAME}" <${process.env.BREVO_SENDER_EMAIL}>`,
//         to: email,
//         subject: "Your Verification Code",
//         text: `Your verification code is: ${otp}. It expires in 10 minutes.`,
//         html: `
//           <div style="font-family: Arial, sans-serif; padding: 20px;">
//             <h2>Verification Code</h2>
//             <p>Your verification code is: <b>${otp}</b></p>
//             <p>It expires in 10 minutes. Do not share this code with anyone.</p>
//           </div>
//         `,
//       });
//       console.log(`[EMAIL_SENT] OTP to: ${email}`);
//     } catch (error) {
//       console.error("Email sending failed:", error);
//       throw new Error("Failed to send verification email. Please try again.");
//     }
//   }

//   // 2. Send Team Invite (Used by TeamDashboardService)
//   static async sendTeamInvite(email: string, teamName: string, magicLink: string) {
//     try {
//       await transporter.sendMail({
//         from: '"CommunityConnect" <no-reply@communityconnect.com>',
//         to: email,
//         subject: `You have been invited to join ${teamName}!`,
//         text: `Click this link to join the team: ${magicLink}`,
//         html: `
//           <div style="font-family: Arial, sans-serif; padding: 20px;">
//             <h2>Team Invitation</h2>
//             <p>You have been invited to join the team <b>${teamName}</b>.</p>
//             <a href="${magicLink}" style="padding: 10px 20px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px;">Accept Invitation</a>
//             <p><small>If the button doesn't work, copy and paste this link: ${magicLink}</small></p>
//           </div>
//         `,
//       });
//       console.log(`[EMAIL_SENT] Invite to: ${email}`);
//     } catch (error) {
//       console.error("Email sending failed:", error);
//       // We don't always throw an error here, because we don't want a failing email 
//       // to crash the entire "Invite" API response.
//     }
//   }

//   // 3. Send Registration Confirmation Email with ticket QR code
//   static async sendRegistrationConfirmationEmail(registrationId: number) {
//     try {
//       const reg = await prisma.registration.findUnique({
//         where: { id: registrationId },
//         include: {
//           user: true,
//           event: true,
//           team: true
//         }
//       });

//       if (!reg) {
//         console.error(`[EMAIL_ERROR] Registration not found for ID: ${registrationId}`);
//         return;
//       }

//       // Ensure ticket_code is present
//       let ticketCode = reg.ticket_code;
//       if (!ticketCode) {
//         ticketCode = `cc_tck_${crypto.randomBytes(12).toString('hex')}`;
//         await prisma.registration.update({
//           where: { id: reg.id },
//           data: { ticket_code: ticketCode }
//         });
//       }

//       // Generate QR Code PNG Buffer
//       const qrBuffer = await QRCode.toBuffer(ticketCode, {
//         margin: 1,
//         color: {
//           dark: '#18181b', // Zinc-900
//           light: '#ffffff'
//         }
//       });

//       // Format Date
//       const formattedDate = new Date(reg.event.start_date).toLocaleDateString('en-US', {
//         weekday: 'long',
//         year: 'numeric',
//         month: 'long',
//         day: 'numeric',
//         hour: 'numeric',
//         minute: '2-digit',
//         timeZoneName: 'short'
//       });

//       const eventUrl = `${env.FRONTEND_URL}/events/${reg.event.id}`;

//       await transporter.sendMail({
//         from: '"CommunityConnect" <no-reply@communityconnect.com>',
//         to: reg.user.email,
//         subject: `Your Registration for ${reg.event.title} is Confirmed!`,
//         text: `Hi ${reg.user.name}, you are registered for ${reg.event.title}. Your ticket code is ${ticketCode}. Go to ${eventUrl} for more details.`,
//         html: `
//           <div style="background-color: #f4f4f5; padding: 40px 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
//             <div style="max-width: 550px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e4e4e7; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);">
//               <!-- Top Gradient Accent Bar -->
//               <div style="height: 8px; background: linear-gradient(90deg, #4f46e5 0%, #7c3aed 50%, #f43f5e 100%);"></div>
              
//               <div style="padding: 32px 24px;">
//                 <!-- Brand Header -->
//                 <div style="margin-bottom: 24px;">
//                   <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
//                     <tr>
//                       <td style="vertical-align: middle; padding-right: 8px;">
//                         <div style="width: 24px; height: 24px; border-radius: 6px; background: linear-gradient(135deg, #4f46e5, #7c3aed);"></div>
//                       </td>
//                       <td style="vertical-align: middle;">
//                         <span style="font-size: 18px; font-weight: 800; color: #18181b; letter-spacing: -0.5px;">CommunityConnect</span>
//                       </td>
//                     </tr>
//                   </table>
//                 </div>

//                 <!-- Main Message -->
//                 <h2 style="font-size: 24px; font-weight: 800; color: #18181b; margin: 0 0 8px 0; line-height: 1.2;">Your Ticket is Confirmed! 🎉</h2>
//                 <p style="font-size: 15px; color: #71717a; margin: 0 0 28px 0; line-height: 1.5;">Hi ${reg.user.name}, your registration is complete. We've generated your entry ticket for the event. See the ticket details below.</p>

//                 <!-- Ticket Card -->
//                 <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 28px;">
//                   <!-- Event Title -->
//                   <h3 style="font-size: 20px; font-weight: 800; color: #18181b; margin: 0 0 12px 0; line-height: 1.3;">${reg.event.title}</h3>
                  
//                   <!-- Badges -->
//                   <div style="margin-bottom: 20px;">
//                     <span style="display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 9999px; background-color: #e0e7ff; color: #4338ca; text-transform: capitalize;">
//                       ${reg.event.mode}
//                     </span>
//                     ${reg.team ? `
//                     <span style="display: inline-block; padding: 4px 10px; font-size: 12px; font-weight: 600; border-radius: 9999px; background-color: #f1f5f9; color: #334155; margin-left: 6px;">
//                       Team: ${reg.team.name}
//                     </span>
//                     ` : ''}
//                   </div>

//                   <!-- Details -->
//                   <table cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse; width: 100%; margin-bottom: 20px;">
//                     <tr>
//                       <td style="padding-bottom: 10px; width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">Attendee</td>
//                       <td style="padding-bottom: 10px; font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">${reg.user.name}</td>
//                     </tr>
//                     <tr>
//                       <td style="padding-bottom: 10px; width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">Date & Time</td>
//                       <td style="padding-bottom: 10px; font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">${formattedDate}</td>
//                     </tr>
//                     ${reg.event.location ? `
//                     <tr>
//                       <td style="width: 90px; font-size: 13px; color: #71717a; font-weight: 500; vertical-align: top;">Location</td>
//                       <td style="font-size: 14px; color: #18181b; font-weight: 600; vertical-align: top;">${reg.event.location}</td>
//                     </tr>
//                     ` : ''}
//                   </table>

//                   <!-- Dashed Separator -->
//                   <div style="border-top: 2px dashed #e2e8f0; height: 1px; margin: 24px 0;"></div>

//                   <!-- QR Code Placement -->
//                   <div style="text-align: center; padding-top: 8px;">
//                     <div style="display: inline-block; padding: 12px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
//                       <img src="cid:ticketqr" alt="Ticket QR Code" style="width: 160px; height: 160px; display: block;" />
//                     </div>
//                     <div style="margin-top: 14px;">
//                       <span style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px;">Ticket Code</span>
//                     </div>
//                     <div style="margin-top: 4px;">
//                       <span style="font-family: Consolas, Monaco, monospace; font-size: 13px; font-weight: 700; color: #1e293b; background-color: #f1f5f9; padding: 4px 10px; border-radius: 6px; border: 1px solid #e2e8f0; display: inline-block;">
//                         ${ticketCode}
//                       </span>
//                     </div>
//                   </div>
//                 </div>

//                 <!-- Call to Action -->
//                 <div style="text-align: center; margin-bottom: 32px;">
//                   <a href="${eventUrl}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #ffffff; font-weight: 700; font-size: 15px; text-decoration: none; border-radius: 9999px; box-shadow: 0 4px 6px -1px rgba(79, 70, 229, 0.2), 0 2px 4px -1px rgba(79, 70, 229, 0.1);">
//                     View Event Dashboard
//                   </a>
//                 </div>

//                 <!-- Guidelines -->
//                 <div style="background-color: #fef08a; border-left: 4px solid #eab308; padding: 12px 16px; border-radius: 6px; margin-bottom: 28px;">
//                   <p style="margin: 0; font-size: 13px; color: #854d0e; font-weight: 500; line-height: 1.4;">
//                     <strong>Important:</strong> Please keep this email handy and present the QR code above on your mobile phone for check-in at the entrance.
//                   </p>
//                 </div>

//                 <!-- Footer -->
//                 <div style="text-align: center; border-top: 1px solid #e4e4e7; padding-top: 24px; font-family: sans-serif;">
//                   <p style="font-size: 13px; color: #a1a1aa; margin: 0 0 6px 0;">Need assistance? Contact the organizer team via the platform.</p>
//                   <p style="font-size: 12px; color: #d4d4d8; margin: 0;">&copy; ${new Date().getFullYear()} CommunityConnect. All rights reserved.</p>
//                 </div>
//               </div>
//             </div>
//           </div>
//         `,
//         attachments: [{
//           filename: 'ticket-qr.png',
//           content: qrBuffer,
//           cid: 'ticketqr'
//         }]
//       });
//       console.log(`[EMAIL_SENT] Registration confirmation (ticket code: ${ticketCode}) sent to: ${reg.user.email}`);
//     } catch (error) {
//       console.error("[EMAIL_ERROR] Failed to send registration confirmation email:", error);
//     }
//   }
// }