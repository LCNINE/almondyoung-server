import { MultipartFile } from '@fastify/multipart';

export interface ValidatedFile extends MultipartFile {
  buffer: Buffer;
}
