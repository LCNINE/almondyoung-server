import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FileRepository } from '../shared/repositories/file.repository';
import { ActivateFileDto } from './dto/activate-file.dto';
import { ActivateResponseDto, DeleteResponseDto } from './dto/activate-response.dto';

@Injectable()
export class LifecycleService {
  constructor(private readonly fileRepository: FileRepository) {}

  async activateFile(fileId: string, dto: ActivateFileDto): Promise<ActivateResponseDto> {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.status === 'active') {
      return {
        success: true,
        fileId: file.id,
        status: file.status,
        message: 'File is already active',
      };
    }

    if (file.status === 'deleted') {
      throw new BadRequestException('Cannot activate a deleted file');
    }

    const updated = await this.fileRepository.updateStatus(fileId, 'active', {
      activatedAt: new Date(),
      relatedId: dto.relatedId,
      relatedType: dto.relatedType,
      metadata: dto.metadata ? { ...file.metadata, ...dto.metadata } : file.metadata,
    });

    return {
      success: true,
      fileId: updated.id,
      status: updated.status,
      message: 'File activated successfully',
    };
  }

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

