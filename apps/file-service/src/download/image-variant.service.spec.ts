import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestError } from '@app/shared';
import sharp = require('sharp');
import { ImageVariantService } from './image-variant.service';
import { StorageService } from '../storage/storage.service';
import { StorageProviderType } from '../storage/storage-provider.interface';
import { Upload } from '../shared/types/file.types';

describe('ImageVariantService', () => {
  let service: ImageVariantService;
  let storageService: { upload: jest.Mock };
  let fetchSpy: jest.SpyInstance;

  const jpegFile = {
    id: 'file-1',
    fileName: 'file-1.jpg',
    originalName: 'photo.jpg',
    mimeType: 'image/jpeg',
    size: 1_000_000,
    filePath: 'products/images/2026/08/file-1.jpg',
    url: 'https://bucket.example/products/images/2026/08/file-1.jpg',
    storageProvider: 's3',
    status: 'active',
    contextId: 'product-image',
    isPublic: true,
  } as unknown as Upload;

  beforeEach(async () => {
    storageService = { upload: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ImageVariantService, { provide: StorageService, useValue: storageService }],
    }).compile();

    service = module.get(ImageVariantService);
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('parse', () => {
    it('returns null when no params are given', () => {
      expect(service.parse(undefined, undefined)).toBeNull();
    });

    it('accepts format=webp without width', () => {
      expect(service.parse('webp', undefined)).toEqual({ format: 'webp' });
    });

    it('accepts a whitelisted width', () => {
      expect(service.parse('webp', '640')).toEqual({ format: 'webp', width: 640 });
    });

    it('rejects unsupported formats', () => {
      expect(() => service.parse('avif', undefined)).toThrow(BadRequestError);
    });

    it('rejects width without format', () => {
      expect(() => service.parse(undefined, '640')).toThrow(BadRequestError);
    });

    it('rejects widths outside the whitelist', () => {
      expect(() => service.parse('webp', '641')).toThrow(BadRequestError);
      expect(() => service.parse('webp', 'abc')).toThrow(BadRequestError);
    });
  });

  describe('resolveUrl', () => {
    it('returns the original url for non-convertible mime types', async () => {
      const gif = { ...jpegFile, mimeType: 'image/gif' } as Upload;
      await expect(service.resolveUrl(gif, { format: 'webp' })).resolves.toBe(gif.url);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns the original url for webp files when no width is requested', async () => {
      const webp = { ...jpegFile, mimeType: 'image/webp' } as Upload;
      await expect(service.resolveUrl(webp, { format: 'webp' })).resolves.toBe(webp.url);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns the original url when the stored url does not end with the file path', async () => {
      const odd = { ...jpegFile, url: 'https://elsewhere.example/legacy-key.jpg' } as Upload;
      await expect(service.resolveUrl(odd, { format: 'webp' })).resolves.toBe(odd.url);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('short-circuits to the derived url when the derivative already exists', async () => {
      fetchSpy.mockResolvedValueOnce({ ok: true } as Response);

      const url = await service.resolveUrl(jpegFile, { format: 'webp', width: 640 });

      expect(url).toBe('https://bucket.example/derived/w640/products/images/2026/08/file-1.jpg.webp');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy.mock.calls[0][1]).toMatchObject({ method: 'HEAD' });
      expect(storageService.upload).not.toHaveBeenCalled();
    });

    it('converts, uploads the derivative, and returns its url on first request', async () => {
      const originalPng = await sharp({
        create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .png()
        .toBuffer();

      fetchSpy.mockResolvedValueOnce({ ok: false, status: 403 } as Response).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () =>
          Promise.resolve(
            originalPng.buffer.slice(originalPng.byteOffset, originalPng.byteOffset + originalPng.byteLength),
          ),
      } as unknown as Response);

      storageService.upload.mockImplementation(async (request) => ({
        success: true,
        key: request.key,
        url: `https://bucket.example/${request.key}`,
        provider: StorageProviderType.S3,
        isPublic: true,
      }));

      const pngFile = {
        ...jpegFile,
        mimeType: 'image/png',
        filePath: 'products/images/2026/08/file-1.png',
        url: 'https://bucket.example/products/images/2026/08/file-1.png',
      } as Upload;

      const url = await service.resolveUrl(pngFile, { format: 'webp', width: 320 });

      expect(url).toBe('https://bucket.example/derived/w320/products/images/2026/08/file-1.png.webp');
      expect(storageService.upload).toHaveBeenCalledTimes(1);
      const uploadRequest = storageService.upload.mock.calls[0][0];
      expect(uploadRequest.key).toBe('derived/w320/products/images/2026/08/file-1.png.webp');
      expect(uploadRequest.contentType).toBe('image/webp');
      expect(uploadRequest.isPublic).toBe(true);
      expect(uploadRequest.cacheControl).toContain('max-age');

      const derivedMeta = await sharp(uploadRequest.buffer).metadata();
      expect(derivedMeta.format).toBe('webp');
      expect(derivedMeta.width).toBe(320);
    });

    it('falls back to the original url when fetching the original fails', async () => {
      fetchSpy
        .mockResolvedValueOnce({ ok: false, status: 403 } as Response)
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response);

      await expect(service.resolveUrl(jpegFile, { format: 'webp' })).resolves.toBe(jpegFile.url);
      expect(storageService.upload).not.toHaveBeenCalled();
    });

    it('falls back to the original url when the derivative upload fails', async () => {
      const originalPng = await sharp({
        create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .png()
        .toBuffer();

      fetchSpy.mockResolvedValueOnce({ ok: false, status: 403 } as Response).mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () =>
          Promise.resolve(
            originalPng.buffer.slice(originalPng.byteOffset, originalPng.byteOffset + originalPng.byteLength),
          ),
      } as unknown as Response);
      storageService.upload.mockRejectedValueOnce(new Error('S3_UPLOAD_FAILED'));

      const pngFile = { ...jpegFile, mimeType: 'image/png' } as Upload;
      await expect(service.resolveUrl(pngFile, { format: 'webp' })).resolves.toBe(pngFile.url);
    });
  });
});
