import { Router } from 'express';
import { AgendaController } from '../controllers/agenda.controller';
import { authenticate } from '../middlewares/auth.middleware';

const router = Router();

// Retrieve user's personalized agenda
router.get('/', authenticate, AgendaController.getUserAgenda);

// Generate/Regenerate ML recommendations for a specific registered event
router.post('/generate/:eventId', authenticate, AgendaController.generateAgenda);

// Accept or Decline a session recommendation
router.patch('/:agendaId/status', authenticate, AgendaController.updateStatus);

// Export personal agenda to standard .ics iCalendar feed
router.get('/export/ics', authenticate, AgendaController.exportICS);

// Two-Way Sync: Add custom personal busy slot for time conflict checking
router.post('/custom-busy-slot', authenticate, AgendaController.addCustomBusySlot);

// Two-Way Sync: Connect Google OAuth token for 2-way Google Calendar import
router.post('/connect-google', authenticate, AgendaController.connectGoogleCalendar);

export default router;
