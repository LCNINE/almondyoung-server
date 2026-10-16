import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { StateStore } from './ports';

export class S3StateStore implements StateStore {
  private readonly client: S3Client;

  constructor(
    private readonly bucket: string,
    private readonly prefix: string,
    region: string,
  ) {
    this.client = new S3Client({ region, maxAttempts: 2 });
  }

  async read<T>(key: string): Promise<T | undefined> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(key) }), {
        abortSignal: AbortSignal.timeout(20000),
      });
      if (!result.Body) throw new Error('Empty S3 state response');
      return JSON.parse(await result.Body.transformToString()) as T;
    } catch (error) {
      if ((error as Error).name === 'NoSuchKey' || (error as Error).name === 'NotFound') return undefined;
      throw error;
    }
  }

  async write(key: string, value: unknown): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(key),
        Body: JSON.stringify(value),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      }),
      { abortSignal: AbortSignal.timeout(20000) },
    );
  }

  async immutable<T>(key: string, sha256: string): Promise<T> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(20000),
    });
    if (!result.Body) throw new Error('Missing manifest');
    const body = await result.Body.transformToString();
    if (createHash('sha256').update(body).digest('hex') !== sha256) throw new Error('Manifest checksum mismatch');

    return JSON.parse(body) as T;
  }

  private key(key: string): string {
    if (!/^[a-zA-Z0-9_./-]+$/.test(key) || key.includes('..') || key.startsWith('/'))
      throw new Error('Invalid state key');
    return `${this.prefix}/${key}`;
  }
}
