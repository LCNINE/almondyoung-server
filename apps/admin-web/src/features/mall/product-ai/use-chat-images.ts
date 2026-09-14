'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadFileToFileService } from '@/lib/api/domains/files/upload.client';
import {
  PRODUCT_AI_IMAGE_CONTEXT,
  PRODUCT_AI_IMAGE_MAX_BYTES,
  PRODUCT_AI_IMAGE_TYPES,
  PRODUCT_AI_IMAGES_PER_MESSAGE,
} from '@packages/product-ai/images';

type DraftImage = {
  id: string;
  file: File;
  fileId?: string;
  fileName: string;
  preview: string;
  status: 'queued' | 'uploading' | 'ready' | 'error';
  progress: number | null;
  error?: string;
};
export function useChatImages(onError: (message: string) => void) {
  const [images, setImages] = useState<DraftImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const inFlight = useRef(false);
  const urls = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      urls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  function update(id: string, patch: Partial<DraftImage>) {
    if (mounted.current)
      setImages((previous) =>
        previous.map((image) =>
          image.id === id ? { ...image, ...patch } : image
        )
      );
  }

  async function upload(image: DraftImage) {
    update(image.id, { status: 'uploading', progress: 0, error: undefined });
    try {
      const uploaded = await uploadFileToFileService(image.file, {
        contextId: PRODUCT_AI_IMAGE_CONTEXT,
        isPublic: false,
        compress: false,
        onProgress: (progress) => update(image.id, { progress }),
      });
      update(image.id, { fileId: uploaded.id, status: 'ready', progress: 100 });
    } catch (error) {
      const message =
        error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : '이미지 업로드 연결에 실패했습니다. 다시 첨부해 주세요.';
      update(image.id, { status: 'error', error: message });
      if (mounted.current) onError(message);
    }
  }

  async function uploadBatch(batch: DraftImage[]) {
    inFlight.current = true;
    setUploading(true);
    try {
      for (const image of batch) {
        if (!mounted.current) return;
        await upload(image);
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setUploading(false);
    }
  }

  async function add(files: File[]) {
    if (inFlight.current || !files.length) return;
    if (files.length + images.length > PRODUCT_AI_IMAGES_PER_MESSAGE) {
      onError('한 번에 이미지는 최대 4장까지 첨부할 수 있어요.');
      return;
    }
    if (
      files.some(
        (file) =>
          !(PRODUCT_AI_IMAGE_TYPES as readonly string[]).includes(file.type) ||
          file.size === 0 ||
          file.size > PRODUCT_AI_IMAGE_MAX_BYTES
      )
    ) {
      onError('5MB 이하 JPG·PNG·WebP 이미지를 선택해 주세요.');
      return;
    }
    const batch: DraftImage[] = files.map((file) => {
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      return {
        id: crypto.randomUUID(),
        file,
        fileName: file.name,
        preview,
        status: 'queued',
        progress: 0,
      };
    });
    setImages((previous) => [...previous, ...batch]);
    await uploadBatch(batch);
  }
  async function retry(id: string) {
    if (inFlight.current) return;
    const image = images.find(
      (item) => item.id === id && item.status === 'error'
    );
    if (image) await uploadBatch([image]);
  }
  function remove(id: string) {
    const image = images.find((item) => item.id === id);
    if (image) {
      URL.revokeObjectURL(image.preview);
      urls.current.delete(image.preview);
    }
    setImages((previous) => previous.filter((item) => item.id !== id));
  }
  function clear() {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current.clear();
    setImages([]);
  }
  const hasUnreadyImages = images.some((image) => image.status !== 'ready');
  return { images, uploading, hasUnreadyImages, add, retry, remove, clear };
}
