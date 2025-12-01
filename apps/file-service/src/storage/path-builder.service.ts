import { Injectable } from '@nestjs/common';

export type FileContext =
  | 'product-image'
  | 'product-document'
  | 'user-avatar'
  | 'user-document'
  | 'invoice'
  | 'receipt'
  | 'shipment-label'
  | 'business-verification-file';

export interface BuildPathParams {
  context: FileContext;
  fileId: string;
  extension: string;
  userId?: string;
  status?: 'pending' | 'active';
}

@Injectable()
export class PathBuilderService {
  buildPath(params: BuildPathParams): string {
    const { context, userId, fileId, extension, status } = params;
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');

    switch (context) {
      case 'product-image':
        return `products/images/${year}/${month}/${fileId}.${extension}`;

      case 'product-document':
        return `products/documents/${year}/${month}/${fileId}.${extension}`;

      case 'user-avatar':
        return `users/avatars/${userId}/${fileId}.${extension}`;

      case 'user-document':
        return `users/documents/${userId}/${year}/${month}/${fileId}.${extension}`;

      case 'invoice':
        return `invoices/${year}/${month}/${fileId}.${extension}`;

      case 'receipt':
        return `receipts/${year}/${month}/${fileId}.${extension}`;

      case 'shipment-label':
        return `shipments/labels/${year}/${month}/${fileId}.${extension}`;

      case 'business-verification-file':
        return `business-licenses/verification-files/${year}/${month}/${fileId}.${extension}`;

      default:
        return `${context}/${year}/${month}/${fileId}.${extension}`;
    }
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

