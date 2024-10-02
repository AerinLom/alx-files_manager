const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
const Bull = require('bull');
const { dbClient } = require('../utils/db');
const { redisClient } = require('../utils/redis');

class FilesController {
  static async postUpload(req, res) {
    const fileQueue = new Bull('fileQueue'); // Added Bull Queue

    const token = req.header('X-Token');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Access the users collection directly from dbClient
    const user = await dbClient.client.db().collection('users').findOne({ _id: ObjectId(userId) });
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      name, type, parentId = 0, isPublic = false, data,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Missing name' });
    }

    const validTypes = ['folder', 'file', 'image'];
    if (!type || !validTypes.includes(type)) {
      return res.status(400).json({ error: 'Missing type' });
    }

    if (type !== 'folder' && !data) {
      return res.status(400).json({ error: 'Missing data' });
    }

    const fileParentId = parentId === '0' ? 0 : parentId; // Adjusting parentId logic
    if (fileParentId !== 0) {
      const parentFile = await dbClient.client.db().collection('files')
        .findOne({ _id: ObjectId(fileParentId) });
      if (!parentFile) {
        return res.status(400).json({ error: 'Parent not found' });
      }
      if (parentFile.type !== 'folder') {
        return res.status(400).json({ error: 'Parent is not a folder' });
      }
    }

    const fileDataDb = {
      userId: ObjectId(userId),
      name,
      type,
      isPublic,
      parentId: fileParentId === 0 ? 0 : ObjectId(fileParentId), // Ensure ObjectId usage
    };

    if (type === 'folder') {
      const result = await dbClient.client.db().collection('files').insertOne(fileDataDb);
      return res.status(201).json({
        id: result.insertedId,
        ...fileDataDb,
      });
    }

    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    const localPath = path.join(folderPath, uuidv4());
    const fileBuffer = Buffer.from(data, 'base64');

    // Use fs.promises for asynchronous file writing
    try {
      await fs.promises.writeFile(localPath, fileBuffer);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    fileDataDb.localPath = localPath;

    const result = await dbClient.client.db().collection('files').insertOne(fileDataDb);

    // Adding to the queue
    fileQueue.add({
      userId: fileDataDb.userId,
      fileId: result.insertedId,
    });

    return res.status(201).json({
      id: result.insertedId,
      ...fileDataDb,
    });
  }
}

module.exports = FilesController;
