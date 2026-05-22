import { Injectable } from '@nestjs/common';
import { NotFoundError, ForbiddenError } from '@app/shared';
import { AuthorizationService } from '@app/authorization';
import { FileRepository } from '../shared/repositories/file.repository';
import { Upload } from '../shared/types/file.types';
import { JwtPayload } from '../shared/types/jwt-payload.interface';

export interface DeleteResult {
  success: boolean;
  message: string;
}

@Injectable()
export class FileAccess {
  constructor(
    private readonly repo: FileRepository,
    private readonly authorization: AuthorizationService,
  ) {}

  async loadReadable(fileId: string, user: JwtPayload): Promise<Upload> {
    const file = await this.repo.findById(fileId);
    if (!file || file.status !== 'active') {
      throw new NotFoundError('File not found');
    }
    if (file.isPublic) {
      return file;
    }
    if (await this.isMasterOrOwner(file, user)) {
      return file;
    }
    throw new ForbiddenError('You do not have permission to access this file');
  }

  async loadPublicServable(fileId: string): Promise<Upload> {
    const file = await this.repo.findById(fileId);
    if (!file || !file.isPublic || file.status !== 'active') {
      throw new NotFoundError('File not found');
    }
    return file;
  }

  async delete(fileId: string, user: JwtPayload): Promise<DeleteResult> {
    const file = await this.repo.findById(fileId);
    if (!file || file.status === 'deleted') {
      throw new NotFoundError('File not found');
    }
    if (!(await this.isMasterOrOwner(file, user))) {
      throw new ForbiddenError('You do not have permission to delete this file');
    }
    await this.repo.softDelete(fileId);
    return { success: true, message: 'File deleted successfully' };
  }

  private async isMasterOrOwner(file: Upload, user: JwtPayload): Promise<boolean> {
    if (file.uploadedBy === user.userId) return true;
    return this.authorization.hasScope(user, 'master');
  }
}
