import sha1 from 'sha1';
import Queue from 'bull/lib/queue';
import { ObjectId } from 'mongodb';
import { dbClient } from '../utils/db';
import { redisClient } from '../utils/redis';

const userQueue = new Queue('email sending');

export default class UsersController {
  static async postNew(req, res) {
    const email = req.body ? req.body.email : null;
    const password = req.body ? req.body.password : null;

    if (!email) {
      return res.status(400).json({ error: 'Missing email' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Missing password' });
    }

    // Check if user already exists
    const user = await (await dbClient.usersCollection()).findOne({ email });
    if (user) {
      return res.status(400).json({ error: 'Already exists' });
    }

    // Insert the new user
    const insertionInfo = await (await dbClient.usersCollection())
      .insertOne({ email, password: sha1(password) });

    const userId = insertionInfo.insertedId.toString();

    // Add user ID to the queue for email sending
    userQueue.add({ userId });

    return res.status(201).json({ email, id: userId });
  }

  static async getMe(req, res) {
    const token = req.header('X-Token') || null; // Use req.header for better clarity

    // Check if token is provided
    if (!token) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    // Retrieve the user ID from Redis using the token
    const redisToken = await redisClient.get(`auth_${token}`);

    // Check if the token exists in Redis
    if (!redisToken) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    // Find the user in the database by ID
    const user = await (await dbClient.usersCollection()).findOne({ _id: ObjectId(redisToken) });

    // Check if the user exists
    if (!user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    // Return the user's information
    return res.status(200).send({ id: user._id, email: user.email });
  }
}
