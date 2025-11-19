import { MultipartFile } from '@fastify/multipart';
import { S3FolderName } from '../constants';

export interface ValidatedFile extends MultipartFile {
  buffer: Buffer;
  folderName: S3FolderName;
}
