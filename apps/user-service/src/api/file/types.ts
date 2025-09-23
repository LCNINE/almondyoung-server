export interface FastifyMultipartFile {
  toBuffer: () => Promise<Buffer>;
  file: NodeJS.ReadableStream;
  filename: string;
  encoding: string;
  mimetype: string;
  fields: Record<string, string>;
}
