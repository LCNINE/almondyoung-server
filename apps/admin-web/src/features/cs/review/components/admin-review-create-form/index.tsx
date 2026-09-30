'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAxiosError } from 'axios';
import { StarIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ImageGalleryField } from '@/components/common/image-gallery-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REVIEW_MEDIA_CONTEXT_ID } from '@/lib/api/domains/files/upload.client';
import { useCreateAdminReview } from '@/lib/services/review';
import { cn } from '@/lib/utils';
import {
  ADMIN_REVIEW_AUTHOR_MAX,
  ADMIN_REVIEW_MAX_MEDIA,
  buildAdminReviewPayload,
  emptyAdminReviewForm,
  kstToday,
  type AdminReviewField,
  type AdminReviewFormValues,
} from '../../lib/admin-review-form';
import { ReviewProductPicker, type PickedProduct } from '../review-product-picker';

const invalidRing = 'ring-2 ring-destructive ring-offset-2';

function serverMessage(error: unknown): string | null {
  if (!isAxiosError(error)) return null;
  const message: unknown = error.response?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return typeof message === 'string' ? message : null;
}

export function AdminReviewCreateForm() {
  const router = useRouter();
  const createMutation = useCreateAdminReview();
  const [values, setValues] = useState<AdminReviewFormValues>(() => emptyAdminReviewForm(new Date()));
  const [product, setProduct] = useState<PickedProduct | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [invalid, setInvalid] = useState<AdminReviewField | null>(null);

  const set = <K extends AdminReviewField>(key: K, value: AdminReviewFormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (invalid === key) setInvalid(null);
  };

  const pickProduct = (next: PickedProduct | null) => {
    setProduct(next);
    set('productId', next?.id ?? null);
  };

  const handleSave = async () => {
    if (uploading || submitted) return;
    const built = buildAdminReviewPayload(values, new Date());
    if (!built.ok) {
      setInvalid(built.field);
      toast.error(built.message);
      return;
    }
    setInvalid(null);

    try {
      const created = await createMutation.mutateAsync(built.payload);
      setSubmitted(true);
      toast.success('리뷰를 등록했어요. 쇼핑몰 상품 리뷰에 바로 보여요.');
      router.push(`/cs/reviews/${created.id}`);
    } catch (error) {
      toast.error(serverMessage(error) ?? '저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  const saving = createMutation.isPending || submitted;

  return (
    <Card>
      <CardHeader>
        <CardTitle>리뷰 작성</CardTitle>
        <p className="text-sm text-muted-foreground">
          다른 채널에서 받은 고객 후기를 옮겨 적습니다. 쇼핑몰에는 일반 리뷰와 똑같이 보입니다.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <section className="flex flex-col gap-2">
          <Label>상품</Label>
          <ReviewProductPicker value={product} onChange={pickProduct} invalid={invalid === 'productId'} />
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="review-author">작성자명</Label>
          <Input
            id="review-author"
            value={values.authorName}
            maxLength={ADMIN_REVIEW_AUTHOR_MAX}
            onChange={(event) => set('authorName', event.target.value)}
            className={cn(invalid === 'authorName' && invalidRing)}
          />
          <p className="text-xs text-muted-foreground">
            원문 이름 그대로 입력하세요. 쇼핑몰에는 가려져 표시됩니다(예: 홍길동 → 홍**).
          </p>
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="review-date">작성일</Label>
          <Input
            id="review-date"
            type="date"
            value={values.writtenDate}
            max={kstToday(new Date())}
            onChange={(event) => set('writtenDate', event.target.value)}
            className={cn('w-48', invalid === 'writtenDate' && invalidRing)}
          />
          <p className="text-xs text-muted-foreground">원래 채널에서 작성된 날짜입니다. 리뷰 목록이 이 날짜 순으로 정렬됩니다.</p>
        </section>

        <section className="flex flex-col gap-2">
          <Label>별점</Label>
          <div
            role="radiogroup"
            aria-label="별점"
            className={cn('flex w-fit gap-1 rounded-md', invalid === 'rating' && invalidRing)}
          >
            {[1, 2, 3, 4, 5].map((score) => {
              const filled = values.rating !== null && score <= values.rating;
              return (
                <button
                  key={score}
                  type="button"
                  role="radio"
                  aria-checked={values.rating === score}
                  aria-label={`${score}점`}
                  onClick={() => set('rating', score)}
                  className="p-1"
                >
                  <StarIcon
                    className={cn('h-7 w-7', filled ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40')}
                  />
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <Label htmlFor="review-content">리뷰 내용</Label>
          <Textarea
            id="review-content"
            rows={8}
            value={values.content}
            onChange={(event) => set('content', event.target.value)}
            className={cn(invalid === 'content' && invalidRing)}
          />
        </section>

        <section className={cn('flex flex-col gap-2 rounded-md', invalid === 'mediaFileIds' && invalidRing)}>
          <ImageGalleryField
            value={values.mediaFileIds}
            onChange={(next) => set('mediaFileIds', next)}
            contextId={REVIEW_MEDIA_CONTEXT_ID}
            label="사진"
            maxImages={ADMIN_REVIEW_MAX_MEDIA}
            disabled={saving}
            onUploadingChange={setUploading}
          />
          <p className="text-xs text-muted-foreground">사진은 {ADMIN_REVIEW_MAX_MEDIA}장까지, 동영상은 올릴 수 없어요.</p>
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/cs/reviews')} disabled={saving}>
            취소
          </Button>
          {/* 저장 중 비활성 — 연타로 같은 리뷰가 두 건 생기지 않게 */}
          <Button type="button" onClick={handleSave} disabled={saving || uploading}>
            {uploading ? '사진 올리는 중…' : saving ? '저장 중…' : '저장'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
