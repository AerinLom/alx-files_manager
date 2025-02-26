import { writeFile } from 'fs';
import { promisify } from 'util';
import Queue from 'bull';
import mongoDBCore from 'mongodb/lib/core';
const thumbnail = require('image-thumbnail');
import dbClient from './utils/db';

const writeFileAsync = promisify(writeFile);
const fileQueue = new Queue('fileQueue');

const generateThumbnail = async (filePath, size) => {
  const buffer = await imgThumbnail(filePath, { width: size });
  return writeFileAsync(`${filePath}_${size}`, buffer);
};

fileQueue.process(async (job, done) => {
  const fileId = job.data.fileId || null;
  const userId = job.data.userId || null;

  if (!fileId) {
    throw new Error('Missing fileId');
  }
  if (!userId) {
    throw new Error('Missing userId');
  }

  const file = await (await dbClient.filesCollection())
    .findOne({
      _id: new mongoDBCore.BSON.ObjectId(fileId),
      userId: new mongoDBCore.BSON.ObjectId(userId),
    });

  if (!file) {
    throw new Error('File not found');
  }

  const sizes = [500, 250, 100];
  await Promise.all(sizes.map((size) => generateThumbnail(file.localPath, size)));
  done();
});
