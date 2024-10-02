import sha1 from 'sha1';
import { v4 as uuidv4 } from 'uuid';
import { redisClient } from '../utils/redis';
import { dbClient } from '../utils/db';

export default class AuthController {
  static async getConnect(req, res) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [email, password] = credentials.split(':');

    if (!email || !password) {
      return res.status(401).json({ error: 'Unauthorized: Missing credentials' });
    }

    const hashedPassword = sha1(password);

    try {
      const user = await (
        await dbClient.usersCollection()
      ).findOne({ email, password: hashedPassword });

      if (!user) {
        return res.status(401).json({ error: 'Unauthorized: User not found or invalid password' });
      }

      const token = uuidv4();
      const tokenKey = `auth_${token}`;

      const expirationTimeInSeconds = 24 * 60 * 60; // 24 hours
      await redisClient.set(tokenKey, user._id.toString(), expirationTimeInSeconds);

      return res.status(200).json({ token });
    } catch (error) {
      console.error('Error during authentication:', error);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  static async getDisconnect(req, res) {
    const token = req.headers['x-token'];

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const tokenKey = `auth_${token}`;
    const u = await redisClient.get(tokenKey);

    if (!u) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await redisClient.del(tokenKey);

    return res.status(204).send();
  }
}
