import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class UploadService {
  constructor(private readonly configService: ConfigService) {}

  async uploadFile(file: Express.Multer.File): Promise<string> {
    return 'uploadFile';
  }

  async batchUploadFiles(files: Array<Express.Multer.File>): Promise<string[]> {
    return ['batchUploadFiles'];
  }
}