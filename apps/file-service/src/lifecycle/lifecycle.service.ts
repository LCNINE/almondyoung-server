import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FileRepository } from '../shared/repositories/file.repository';
import { DeleteResponseDto } from './dto/activate-response.dto';

@Injectable()
export class LifecycleService {
  constructor(private readonly fileRepository: FileRepository) { }


  async deleteFile(fileId: string, userId: string): Promise<DeleteResponseDto> {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.uploadedBy !== userId) {
      throw new ForbiddenException('Not authorized to delete this file');
    }

    if (file.status === 'deleted') {
      return {
        success: true,
        message: 'File is already deleted',
      };
    }

    await this.fileRepository.softDelete(fileId);

    return {
      success: true,
      message: 'File deleted successfully',
    };
  }
}

