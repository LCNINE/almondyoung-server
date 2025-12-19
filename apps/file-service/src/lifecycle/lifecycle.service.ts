import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { FileRepository } from '../shared/repositories/file.repository';
import { DeleteResponseDto } from './dto/delete-response.dto';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

@Injectable()
export class LifecycleService {
  constructor(private readonly fileRepository: FileRepository) { }


  async deleteFile(fileId: string, user: JwtPayload): Promise<DeleteResponseDto> {
    const file = await this.fileRepository.findById(fileId);

    if (!file) {
      throw new NotFoundException('File not found');
    }

    // Master scope 보유자 또는 owner만 삭제 가능
    const isMaster = user.roles.includes('master');
    const isOwner = file.uploadedBy === user.userId;

    if (!isMaster && !isOwner) {
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

