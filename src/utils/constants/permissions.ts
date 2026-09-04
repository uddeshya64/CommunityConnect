export const EVENT_PERMISSIONS = {
  // Existing permissions (kept for backward compatibility)
  MANAGE_EVENT: 'MANAGE_EVENT',                   // Edit details, dates, etc.
  MANAGE_STAFF: 'MANAGE_STAFF',                   // Invite/remove other staff
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',               // Access the backend organizer UI
  MANAGE_ATTENDEES: 'MANAGE_ATTENDEES',           // Accept/reject registrations
  SCORE_SUBMISSIONS: 'SCORE_SUBMISSIONS',         // Grade projects
  MANAGE_COMMUNICATIONS: 'MANAGE_COMMUNICATIONS', // Send emails/announcements

  // --- Granular Permissions Mapping to the 10 Staff Roles ---
  
  // Event Director
  MANAGE_EVENT_SETUP: 'MANAGE_EVENT_SETUP',
  MANAGE_BUDGET: 'MANAGE_BUDGET',
  MANAGE_READINESS: 'MANAGE_READINESS',
  MANAGE_APPROVALS: 'MANAGE_APPROVALS',
  VIEW_EXECUTIVE_DASHBOARD: 'VIEW_EXECUTIVE_DASHBOARD',

  // Program Manager
  MANAGE_AGENDA: 'MANAGE_AGENDA',
  MANAGE_TRACKS: 'MANAGE_TRACKS',
  MANAGE_SESSIONS: 'MANAGE_SESSIONS',
  MANAGE_SPEAKERS: 'MANAGE_SPEAKERS',
  MANAGE_CONTENT: 'MANAGE_CONTENT',

  // Venue & Operations Manager
  MANAGE_ROOMS: 'MANAGE_ROOMS',
  MANAGE_EQUIPMENT: 'MANAGE_EQUIPMENT',
  MANAGE_ACCESS: 'MANAGE_ACCESS',
  MANAGE_QUEUES: 'MANAGE_QUEUES',
  MANAGE_INCIDENTS: 'MANAGE_INCIDENTS',
  MANAGE_ONSITE_STAFF: 'MANAGE_ONSITE_STAFF',

  // Registration Manager
  MANAGE_FORMS: 'MANAGE_FORMS',
  MANAGE_TICKETS: 'MANAGE_TICKETS',
  MANAGE_INVITATIONS: 'MANAGE_INVITATIONS',
  MANAGE_CHECK_IN: 'MANAGE_CHECK_IN',
  MANAGE_REFUNDS: 'MANAGE_REFUNDS',

  // Marketing Manager
  MANAGE_CAMPAIGNS: 'MANAGE_CAMPAIGNS',
  MANAGE_REFERRALS: 'MANAGE_REFERRALS',

  // Sponsor/Exhibitor Manager
  MANAGE_SPONSORS: 'MANAGE_SPONSORS',
  MANAGE_BOOTHS: 'MANAGE_BOOTHS',
  MANAGE_SPONSOR_DELIVERABLES: 'MANAGE_SPONSOR_DELIVERABLES',
  VIEW_SPONSOR_ROI: 'VIEW_SPONSOR_ROI',

  // Speaker / Judge / Mentor Portals
  ACCESS_SPEAKER_PORTAL: 'ACCESS_SPEAKER_PORTAL',

  // Volunteer / Vendor Portals
  VIEW_SHIFTS: 'VIEW_SHIFTS',
  MANAGE_ASSIGNED_TASKS: 'MANAGE_ASSIGNED_TASKS',
  ACKNOWLEDGE_TASKS: 'ACKNOWLEDGE_TASKS',

  // Auditor / Support Scopes
  ACCESS_SUPPORT_PORTAL: 'ACCESS_SUPPORT_PORTAL',
  VIEW_AUDIT_LOGS: 'VIEW_AUDIT_LOGS'
} as const;

export type EventPermission = keyof typeof EVENT_PERMISSIONS;

export function getDefaultPermissionsForRole(roleName: string): string[] {
  const normalized = (roleName || '').trim().toLowerCase();

  if (normalized.includes('admin') || normalized.includes('director') || normalized.includes('organizer') || normalized.includes('owner')) {
    // Admin gets all permissions by default
    return Object.values(EVENT_PERMISSIONS);
  }

  if (normalized.includes('registration')) {
    // Registration role gets all registration-related permissions
    return [
      EVENT_PERMISSIONS.MANAGE_ATTENDEES,
      EVENT_PERMISSIONS.MANAGE_FORMS,
      EVENT_PERMISSIONS.MANAGE_TICKETS,
      EVENT_PERMISSIONS.MANAGE_INVITATIONS,
      EVENT_PERMISSIONS.MANAGE_CHECK_IN,
      EVENT_PERMISSIONS.MANAGE_REFUNDS,
      EVENT_PERMISSIONS.VIEW_DASHBOARD
    ];
  }

  // All other staff members get view level permissions for now
  return [EVENT_PERMISSIONS.VIEW_DASHBOARD];
}