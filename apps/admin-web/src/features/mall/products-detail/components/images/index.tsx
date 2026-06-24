'use client';

import Image from 'next/image';
import {
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { ImagePlus, Pencil, Save, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { CardErrorBoundary } from '@/components/admin-ui-experimental/common/card-error-boundary';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Spinner } from '@/components/ui/spinner';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import {
  PRODUCT_IMAGE_CONTEXT_ID,
  uploadFileToFileService,
} from '@/lib/api/domains/files/upload.client';
import { useUpdateMasterVersion } from '@/lib/services/products/mutations';
import { useProductDetailSuspense } from '@/lib/services/products/use-product-detail';
import type { ProductDetailView } from '@/lib/services/products/use-product-detail';
import {
  PRODUCT_ADDITIONAL_IMAGE_LIMIT,
  canAddAdditionalProductImage,
  canEditProductImages,
  splitProductImages,
  toProductImageFormValues,
  toProductImageUpdateDto,
  type ProductImageFormValues,
} from './product-images-model';

type Props = { masterId: string; versionId: string | null };
type UploadTarget = 'representative' | 'additional';

function ImagePreview({
  fileId,
  alt,
  sizes,
}: {
  fileId: string;
  alt: string;
  sizes: string;
}) {
  return (
    <Image
      src={resolvePublicFileUrl(fileId) ?? ''}
      alt={alt}
      fill
      className="object-contain"
      sizes={sizes}
      unoptimized
    />
  );
}

function ProductImagesDisplay({ detail }: { detail: ProductDetailView }) {
  const { primary, rest } = useMemo(() => {
    const { representative, additional } = splitProductImages(detail.images);
    return { primary: representative, rest: additional };
  }, [detail.images]);

  if (!primary && rest.length === 0) {
    return <div className="p-3 text-sm text-gray-500">이미지 없음</div>;
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-gray-50">
        {primary ? (
          <ImagePreview
            fileId={primary.fileId}
            alt="대표 이미지"
            sizes="(max-width: 1280px) 100vw, 440px"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            대표 이미지 없음
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {rest.map((img) => (
            <div
              key={img.id}
              className="relative aspect-square overflow-hidden rounded-md bg-gray-50"
            >
              <ImagePreview
                fileId={img.fileId}
                alt="부가 이미지"
                sizes="110px"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductImageEditDrawer({
  masterId,
  detail,
  open,
  onOpenChange,
}: {
  masterId: string;
  detail: ProductDetailView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateVersion = useUpdateMasterVersion();
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadTargetRef = useRef<UploadTarget>('representative');
  const [values, setValues] = useState<ProductImageFormValues>(() =>
    toProductImageFormValues(detail)
  );
  const [uploadingTarget, setUploadingTarget] = useState<UploadTarget | null>(
    null
  );

  useEffect(() => {
    if (open) {
      setValues(toProductImageFormValues(detail));
    }
  }, [open, detail]);

  const busy = updateVersion.isPending || uploadingTarget !== null;
  const canSubmit = Boolean(detail.versionId) && !busy;
  const canAddAdditional = canAddAdditionalProductImage(
    values.additionalImageFileIds
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (busy) return;
    onOpenChange(nextOpen);
  };

  const chooseFile = (target: UploadTarget) => {
    if (target === 'additional' && !canAddAdditional) {
      toast.error('부가 이미지는 최대 5개까지 가능합니다.');
      return;
    }

    uploadTargetRef.current = target;
    inputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const target = uploadTargetRef.current;
    if (target === 'additional' && !canAddAdditional) {
      toast.error('부가 이미지는 최대 5개까지 가능합니다.');
      return;
    }

    setUploadingTarget(target);
    try {
      const upload = await uploadFileToFileService(file, {
        contextId: PRODUCT_IMAGE_CONTEXT_ID,
        isPublic: true,
      });

      setValues((current) => {
        if (target === 'representative') {
          return { ...current, representativeFileId: upload.id };
        }

        return {
          ...current,
          additionalImageFileIds: [
            ...current.additionalImageFileIds,
            upload.id,
          ],
        };
      });
      toast.success('상품 이미지를 업로드했습니다.');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '상품 이미지 업로드에 실패했습니다.'
      );
    } finally {
      setUploadingTarget(null);
    }
  };

  const removeAdditionalImage = (index: number) => {
    setValues((current) => ({
      ...current,
      additionalImageFileIds: current.additionalImageFileIds.filter(
        (_, currentIndex) => currentIndex !== index
      ),
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detail.versionId || !canSubmit) return;

    let dto: ReturnType<typeof toProductImageUpdateDto>;
    try {
      dto = toProductImageUpdateDto(values);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : '상품 이미지 입력값을 확인해주세요.'
      );
      return;
    }

    updateVersion.mutate(
      {
        masterId,
        versionId: detail.versionId,
        dto,
      },
      {
        onSuccess: () => {
          toast.success('상품 이미지를 저장했습니다.');
          onOpenChange(false);
        },
        onError: (error) => {
          toast.error(
            error instanceof Error
              ? error.message
              : '상품 이미지 저장에 실패했습니다.'
          );
        },
      }
    );
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange} direction="right">
      <DrawerContent>
        <form onSubmit={handleSubmit} className="flex h-full flex-col">
          <DrawerHeader>
            <DrawerTitle>이미지 수정</DrawerTitle>
            <DrawerDescription>
              draft version의 대표 이미지와 부가 이미지를 수정합니다.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-1 flex-col gap-5 overflow-auto px-4 pb-4">
            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">대표 이미지</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => chooseFile('representative')}
                  >
                    <Upload data-icon="inline-start" />
                    {uploadingTarget === 'representative'
                      ? '업로드 중...'
                      : values.representativeFileId
                        ? '교체'
                        : '업로드'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || !values.representativeFileId}
                    onClick={() =>
                      setValues((current) => ({
                        ...current,
                        representativeFileId: null,
                      }))
                    }
                  >
                    <Trash2 data-icon="inline-start" />
                    비우기
                  </Button>
                </div>
              </div>

              <div className="relative aspect-square overflow-hidden rounded-md border bg-gray-50">
                {values.representativeFileId ? (
                  <ImagePreview
                    fileId={values.representativeFileId}
                    alt="대표 이미지 미리보기"
                    sizes="360px"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    이미지 없음
                  </div>
                )}
              </div>
            </section>

            <section className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium">
                  부가 이미지 {values.additionalImageFileIds.length}/
                  {PRODUCT_ADDITIONAL_IMAGE_LIMIT}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !canAddAdditional}
                  onClick={() => chooseFile('additional')}
                >
                  <ImagePlus data-icon="inline-start" />
                  {uploadingTarget === 'additional' ? '업로드 중...' : '추가'}
                </Button>
              </div>

              {values.additionalImageFileIds.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {values.additionalImageFileIds.map((fileId, index) => (
                    <div
                      key={`${fileId}-${index}`}
                      className="group relative aspect-square overflow-hidden rounded-md border bg-gray-50"
                    >
                      <ImagePreview
                        fileId={fileId}
                        alt={`부가 이미지 ${index + 1}`}
                        sizes="120px"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="destructive"
                        className="absolute right-1 top-1 size-7 opacity-95"
                        disabled={busy}
                        aria-label={`부가 이미지 ${index + 1} 삭제`}
                        onClick={() => removeAdditionalImage(index)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                  부가 이미지 없음
                </div>
              )}
            </section>
          </div>

          <DrawerFooter className="border-t sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {updateVersion.isPending ? (
                <Spinner size="sm" />
              ) : (
                <Save data-icon="inline-start" />
              )}
              {updateVersion.isPending ? '저장 중...' : '저장'}
            </Button>
          </DrawerFooter>

          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={handleFileChange}
          />
        </form>
      </DrawerContent>
    </Drawer>
  );
}

function ProductDetailImagesContent({ masterId, versionId }: Props) {
  const { data } = useProductDetailSuspense(masterId, versionId);
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = canEditProductImages(data);

  return (
    <>
      <Header
        title="이미지"
        subtitle={
          !canEdit
            ? '이미지는 draft version에서만 수정할 수 있습니다.'
            : undefined
        }
        right={
          canEdit ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditOpen(true)}
            >
              <Pencil data-icon="inline-start" />
              수정
            </Button>
          ) : null
        }
      />
      <ProductImagesDisplay detail={data} />
      {canEdit && (
        <ProductImageEditDrawer
          masterId={masterId}
          detail={data}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </>
  );
}

export function ProductDetailImages({ masterId, versionId }: Props) {
  return (
    <Container>
      <CardErrorBoundary>
        <Suspense
          fallback={
            <>
              <Header title="이미지" />
              <div className="flex justify-center p-4">
                <Spinner />
              </div>
            </>
          }
        >
          <ProductDetailImagesContent
            masterId={masterId}
            versionId={versionId}
          />
        </Suspense>
      </CardErrorBoundary>
    </Container>
  );
}
