import { Router } from 'express';
import AppController from '../controllers/AppController';

const router = Router();

router.get('/status', AppController.getStatus);
router.get('/stats', AppController.getStats);
router.post('/users', UsersController.postNew);

export default router;
