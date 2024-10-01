import sha1 from 'sha1';
import Queue from 'bull/lib/queue';
import { dbClient } from '../utils/db';

const userQueue = new Queue('email sending');

export default class UsersController {
  static async postNew(req, res) {
    const email = req.body ? req.body.email : null;
    const password = req.body ? req.body.password : null;

    if (!email) {
      console.log('Missing email in request');
      res.status(400).json({ error: 'Missing email' });
      return;
    }
    if (!password) {
      console.log('Missing password in request');
      res.status(400).json({ error: 'Missing password' });
      return;
    }

    const user = await (await dbClient.usersCollection()).findOne({ email });

    if (user) {
      console.log('Email already exists:', email);
      res.status(400).json({ error: 'Already exist' });
      return;
    }

    const hashedPassword = sha1(password);
    const usersCollection = await dbClient.usersCollection();
    const insertionInfo = await usersCollection.insertOne({ email, password: hashedPassword });

    const userId = insertionInfo.insertedId.toString();

    console.log(`User created with ID: ${userId}`);

    userQueue.add({ userId });
    res.status(201).json({ email, id: userId });
  }

  static async getMe(req, res) {
    const { user } = req;
    console.log(`Fetching details for user ID: ${user._id}`);
    res.status(200).json({ email: user.email, id: user._id.toString() });
  }
}
