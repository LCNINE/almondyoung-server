import { Controller, Post, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { UploadService } from './upload.service';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.uploadFile(file);
  }

  @Post('batch-upload')
  @UseInterceptors(FilesInterceptor('files'))
  async batchUploadFiles(@UploadedFiles() files: Array<Express.Multer.File>) {
    return this.uploadService.batchUploadFiles(files);
  }
}