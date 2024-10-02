/* eslint-disable */
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const { ObjectId } = require('mongodb');
const Bull = require('bull');
const { dbClient } = require('../utils/db');
const { redisClient } = require('../utils/redis');
const mime = require('mime-types');

class FilesController {
  static async postUpload(req, res) {
    const fileQueue = new Bull('fileQueue');

    const token = req.header('X-Token');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

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

    const fileParentId = parentId === '0' ? 0 : parentId;
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
      parentId: fileParentId === 0 ? 0 : ObjectId(fileParentId),
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

    try {
      await fs.promises.writeFile(localPath, fileBuffer);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }

    fileDataDb.localPath = localPath;

    const result = await dbClient.client.db().collection('files').insertOne(fileDataDb);

    fileQueue.add({
      userId: fileDataDb.userId,
      fileId: result.insertedId,
    });

    return res.status(201).json({
      id: result.insertedId,
      ...fileDataDb,
    });
  }

  static async getShow(req, res) {
    const token = req.header('X-Token');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const fileId = req.params.id;
    try {
      const file = await dbClient.client.db().collection('files').findOne({
        _id: ObjectId(fileId),
        userId: ObjectId(userId),
      });

      if (!file) {
        return res.status(404).json({ error: 'Not found' });
      }

      return res.status(200).json(file);
    } catch (error) {
      console.error('Error retrieving file:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async getIndex(req, res) {
    const token = req.header('X-Token');

    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      const files = await dbClient.client.db().collection('files').find({ userId: ObjectId(userId) }).toArray();

      return res.status(200).json(files);
    } catch (error) {
      console.error('Error retrieving files:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }

  static async putPublish(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const redisToken = await redisClient.get(`auth_${token}`);
    if (!redisToken) return res.status(401).json({ error: 'Unauthorized' });

    const user = await dbClient.client.db()
      .collection('users')
      .findOne({ _id: ObjectId(redisToken) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const idFile = req.params.id || '';

    let fileDocument = await dbClient.client.db()
      .collection('files')
      .findOne({ _id: ObjectId(idFile), userId: user._id });
    if (!fileDocument) return res.status(404).json({ error: 'Not found' });

    await dbClient.client.db()
      .collection('files')
      .updateOne({ _id: ObjectId(idFile) }, { $set: { isPublic: true } });
    fileDocument = await dbClient.client.db()
      .collection('files')
      .findOne({ _id: ObjectId(idFile), userId: user._id });

    return res.status(200).json({
      id: fileDocument._id,
      userId: fileDocument.userId,
      name: fileDocument.name,
      type: fileDocument.type,
      isPublic: fileDocument.isPublic,
      parentId: fileDocument.parentId,
    });
  }

  static async putUnpublish(req, res) {
    const token = req.header('X-Token');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const redisToken = await redisClient.get(`auth_${token}`);
    if (!redisToken) return res.status(401).json({ error: 'Unauthorized' });

    const user = await dbClient.client.db()
      .collection('users')
      .findOne({ _id: ObjectId(redisToken) });
    if (!user) return res.status(401).json({ error: 'Unauthorized' });

    const idFile = req.params.id || '';

    let fileDocument = await dbClient.client.db()
      .collection('files')
      .findOne({ _id: ObjectId(idFile), userId: user._id });
    if (!fileDocument) return res.status(404).json({ error: 'Not found' });

    await dbClient.client.db()
      .collection('files')
      .updateOne({ _id: ObjectId(idFile), userId: user._id }, { $set: { isPublic: false } });
    fileDocument = await dbClient.client.db()
      .collection('files')
      .findOne({ _id: ObjectId(idFile), userId: user._id });

    return res.status(200).json({
      id: fileDocument._id,
      userId: fileDocument.userId,
      name: fileDocument.name,
      type: fileDocument.type,
      isPublic: fileDocument.isPublic,
      parentId: fileDocument.parentId,
    });
  }
  static async getFile(req, res) {
    const idFile = req.params.id || '';
    const size = req.query.size || 0;

    const fileDocument = await dbClient.client.db()
      .collection('files')
      .findOne({ _id: ObjectId(idFile) });
    if (!fileDocument) return res.status(404).json({ error: 'Not found' });

    const { isPublic } = fileDocument;
    const { userId } = fileDocument;
    const { type } = fileDocument;

    let user = null;
    let owner = false;

    const token = req.header('X-Token') || null;
    if (token) {
      const redisToken = await redisClient.get(`auth_${token}`);
      if (redisToken) {
        user = await dbClient.client.db()
          .collection('users')
          .findOne({ _id: ObjectId(redisToken) });
        if (user && user._id.equals(userId)) {
          owner = true;
        }
      }
    }

    if (!isPublic && !owner) {
      return res.status(404).json({ error: 'Not found' });
    }

    if (type === 'folder') {
      return res.status(400).json({ error: "A folder doesn't have content" });
    }

    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    const realPath = size === 0
      ? fileDocument.localPath
      : `${fileDocument.localPath}_${size}`;

    const filePath = realPath.startsWith(folderPath)
      ? realPath
      : path.join(folderPath, realPath);

    try {
      const dataFile = fs.readFileSync(filePath);

      const mimeType = mime.contentType(fileDocument.name);
      res.setHeader('Content-Type', mimeType);

      return res.send(dataFile);
    } catch (err) {
      console.error('Error downloading file:', err);
      return res.status(404).json({ error: 'Not found' });
    }
  }
}

module.exports = FilesController;
