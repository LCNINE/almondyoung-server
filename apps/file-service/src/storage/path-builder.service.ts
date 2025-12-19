import { Injectable } from '@nestjs/common';

export interface BuildPathParams {
  prefix: string;
  fileId: string;
  extension: string;
}

@Injectable()
export class PathBuilderService {
  buildPath(params: BuildPathParams): string {
    const { prefix, fileId, extension } = params;
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    return `${prefix}/${year}/${month}/${fileId}.${extension}`;
  }

  getPendingPathPrefix(olderThanDate: Date): string {
    const year = olderThanDate.getFullYear();
    const month = String(olderThanDate.getMonth() + 1).padStart(2, '0');
    return `temp/pending/${year}/${month}/`;
  }

  getUserPathPrefix(userId: string): string {
    return `users/${userId}/`;
  }
}

