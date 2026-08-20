import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestError, ForbiddenError, NotFoundError } from '@app/shared';
import { UploadService } from './upload.service';
import { StorageService } from '../storage/storage.service';
import { PathBuilderService } from '../storage/path-builder.service';
import { FileRepository } from '../shared/repositories/file.repository';
import { FileContextRepository } from '../shared/repositories/file-context.repository';
import { FileContextValidator } from '../shared/services/file-context-validator.service';
import { FileTypeDetector } from '../shared/services/file-type-detector.service';
import { StorageProviderType } from '../storage/storage-provider.interface';
import { FileContext, Upload } from '../shared/types/file.types';

describe('UploadService (direct upload)', () => {
  let service: UploadService;
  let storageService: {
    getDirectUploadPort: jest.Mock;
    delete: jest.Mock;
    upload: jest.Mock;
  };
  let directPort: { createDirectUpload: jest.Mock; headObject: jest.Mock };
  let fileRepository: {
    create: jest.Mock;
    findById: jest.Mock;
    updateStatus: jest.Mock;
    softDelete: jest.Mock;
  };
  let fileContextRepository: { findById: jest.Mock };

  const imageContext = {
    id: 'banner-image',
    name: 'Banner Image',
    allowPublic: true,
    allowPrivate: false,
    allowedMimeTypes: ['image/*'],
    maxFileSize: 10 * 1024 * 1024,
    pathPrefix: 'banners/images',
    isActive: true,
  } as unknown as FileContext;

  const pendingFile = {
    id: 'file-1',
    fileName: 'file-1.webp',
    originalName: 'photo.webp',
    mimeType: 'image/webp',
    size: 5_000_000,
    filePath: 'banners/images/2026/08/file-1.webp',
    url: 'https://bucket.example/banners/images/2026/08/file-1.webp',
    storageProvider: 's3',
    status: 'pending',
    contextId: 'banner-image',
    uploadedBy: 'user-1',
    isPublic: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    activatedAt: null,
  } as unknown as Upload;

  beforeEach(async () => {
    directPort = {
      createDirectUpload: jest.fn().mockResolvedValue({
        provider: StorageProviderType.S3,
        uploadUrl: 'https://bucket.example/signed-put',
        headers: { 'Content-Type': 'image/webp' },
        fileUrl: 'https://bucket.example/banners/images/2026/08/file-1.webp',
        expiresAt: new Date(Date.now() + 600_000),
      }),
      headObject: jest.fn(),
    };
    storageService = {
      getDirectUploadPort: jest.fn().mockReturnValue(directPort),
      delete: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn(),
    };
    fileRepository = {
      create: jest.fn().mockImplementation((data: Record<string, unknown>) => Promise.resolve(data)),
      findById: jest.fn(),
      updateStatus: jest.fn(),
      softDelete: jest.fn().mockResolvedValue(undefined),
    };
    fileContextRepository = { findById: jest.fn().mockResolvedValue(imageContext) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadService,
        FileContextValidator,
        FileTypeDetector,
        PathBuilderService,
        { provide: StorageService, useValue: storageService },
        { provide: FileRepository, useValue: fileRepository },
        { provide: FileContextRepository, useValue: fileContextRepository },
      ],
    }).compile();

    service = module.get(UploadService);
  });

  describe('presignUpload', () => {
    const dto = {
      contextId: 'banner-image',
      fileName: 'photo.webp',
      size: 5_000_000,
      mimeType: 'image/webp',
    };

    it('발급 시점에 컨텍스트 검증을 통과하면 pending 레코드를 만들고 presigned URL 을 돌려준다', async () => {
      const result = await service.presignUpload(dto, 'user-1');

      expect(result.uploadUrl).toBe('https://bucket.example/signed-put');
      expect(result.headers['Content-Type']).toBe('image/webp');
      expect(result.fileId).toBeDefined();

      expect(fileRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          contextId: 'banner-image',
          uploadedBy: 'user-1',
          originalName: 'photo.webp',
          mimeType: 'image/webp',
          size: 5_000_000,
          isPublic: true,
          storageProvider: 's3',
        }),
      );

      expect(directPort.createDirectUpload).toHaveBeenCalledWith(
        expect.objectContaining({ contentType: 'image/webp', isPublic: true }),
      );
    });

    it('신고 크기가 컨텍스트 상한을 넘으면 발급을 거부한다', async () => {
      await expect(service.presignUpload({ ...dto, size: 11 * 1024 * 1024 }, 'user-1')).rejects.toThrow(
        BadRequestError,
      );
      expect(fileRepository.create).not.toHaveBeenCalled();
    });

    it('허용 안 된 MIME 타입이면 발급을 거부한다', async () => {
      await expect(service.presignUpload({ ...dto, mimeType: 'application/zip' }, 'user-1')).rejects.toThrow(
        BadRequestError,
      );
    });

    it('비활성 컨텍스트면 발급을 거부한다', async () => {
      fileContextRepository.findById.mockResolvedValue({ ...imageContext, isActive: false });
      await expect(service.presignUpload(dto, 'user-1')).rejects.toThrow(BadRequestError);
    });

    it('직접 업로드를 지원하지 않는 프로바이더면 404 로 거부해 클라이언트가 폴백하게 한다', async () => {
      storageService.getDirectUploadPort.mockReturnValue(null);
      await expect(service.presignUpload(dto, 'user-1')).rejects.toThrow(NotFoundError);
    });
  });

  describe('confirmUpload', () => {
    beforeEach(() => {
      fileRepository.findById.mockResolvedValue(pendingFile);
      directPort.headObject.mockResolvedValue({ size: 5_000_000, contentType: 'image/webp' });
      fileRepository.updateStatus.mockImplementation((_id: string, status: string, extra?: Record<string, unknown>) =>
        Promise.resolve({ ...pendingFile, status, ...extra }),
      );
    });

    it('객체가 실재하면 실측 크기로 active 전환하고 업로드 응답 모양을 돌려준다', async () => {
      const result = await service.confirmUpload('file-1', 'user-1');

      expect(fileRepository.updateStatus).toHaveBeenCalledWith(
        'file-1',
        'active',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ size: 5_000_000, activatedAt: expect.any(Date) }),
      );
      expect(result).toEqual({
        id: 'file-1',
        url: pendingFile.url,
        fileName: 'file-1.webp',
        size: 5_000_000,
        status: 'active',
        isPublic: true,
      });
    });

    it('스토리지에 객체가 없으면 거부한다', async () => {
      directPort.headObject.mockResolvedValue(null);
      await expect(service.confirmUpload('file-1', 'user-1')).rejects.toThrow(BadRequestError);
      expect(fileRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('실측 크기가 컨텍스트 상한을 넘으면 객체를 지우고 거부한다', async () => {
      directPort.headObject.mockResolvedValue({ size: 11 * 1024 * 1024 });

      await expect(service.confirmUpload('file-1', 'user-1')).rejects.toThrow(BadRequestError);
      expect(storageService.delete).toHaveBeenCalledWith({
        key: pendingFile.filePath,
        isPublic: true,
      });
      expect(fileRepository.softDelete).toHaveBeenCalledWith('file-1');
      expect(fileRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('실제 올라온 Content-Type 이 화이트리스트를 벗어나면 객체를 지우고 거부한다', async () => {
      directPort.headObject.mockResolvedValue({ size: 1000, contentType: 'text/html' });

      await expect(service.confirmUpload('file-1', 'user-1')).rejects.toThrow(BadRequestError);
      expect(storageService.delete).toHaveBeenCalledWith({
        key: pendingFile.filePath,
        isPublic: true,
      });
      expect(fileRepository.softDelete).toHaveBeenCalledWith('file-1');
      expect(fileRepository.updateStatus).not.toHaveBeenCalled();
    });

    it('발급자가 아니면 거부한다', async () => {
      await expect(service.confirmUpload('file-1', 'other-user')).rejects.toThrow(ForbiddenError);
    });

    it('없는 파일이거나 삭제된 파일이면 404', async () => {
      fileRepository.findById.mockResolvedValue(undefined);
      await expect(service.confirmUpload('nope', 'user-1')).rejects.toThrow(NotFoundError);

      fileRepository.findById.mockResolvedValue({ ...pendingFile, status: 'deleted' });
      await expect(service.confirmUpload('file-1', 'user-1')).rejects.toThrow(NotFoundError);
    });

    it('이미 active 면 다시 검사하지 않고 같은 응답을 돌려준다', async () => {
      fileRepository.findById.mockResolvedValue({ ...pendingFile, status: 'active' });

      const result = await service.confirmUpload('file-1', 'user-1');

      expect(result.status).toBe('active');
      expect(directPort.headObject).not.toHaveBeenCalled();
      expect(fileRepository.updateStatus).not.toHaveBeenCalled();
    });
  });
});
