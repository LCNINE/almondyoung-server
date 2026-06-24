'use client';

import React, { Suspense, useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container';
import { Header } from '@/components/admin-ui-experimental/common/header';
import { Spinner } from '@/components/ui/spinner';
import { useQuestion } from '@/lib/services/qna';
import { useMastersByIds } from '@/lib/services/products/queries';
import { useOptionalAdminUser } from '@/lib/services/users/queries';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  QuestionCategory,
  QuestionStatus,
} from '@/lib/types/dto/qna';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselPrevious,
  CarouselNext,
  type CarouselApi,
} from '@/components/ui/carousel';
import { LockIcon } from 'lucide-react';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';
import Image from 'next/image';
import { QuestionDeleteButton } from '../question-delete-button';

function QuestionDetailContent({ questionId }: { questionId: string }) {
  const { data } = useQuestion(questionId);
  const { data: author } = useOptionalAdminUser(data.userId);
  // 상품 문의면 productId(=masterId)로 상품명 조회. 일반 문의(null)면 배치가 빈 배열이라 호출 안 됨.
  const { data: products } = useMastersByIds(
    data.productId ? [data.productId] : []
  );
  const productName = products?.data?.[0]?.name;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();

  const imageUrls = data.mediaFileIds.map(
    (fileId) => resolvePublicFileUrl(fileId) ?? ''
  );

  const handleImageClick = (index: number) => {
    setSelectedIndex(index);
  };

  // 캐러셀이 열릴 때 선택한 이미지로 이동
  React.useEffect(() => {
    if (carouselApi && selectedIndex !== null) {
      carouselApi.scrollTo(selectedIndex);
    }
  }, [carouselApi, selectedIndex]);

  const rows: { key: string; value: React.ReactNode }[] = [
    { key: '작성자', value: author?.username || data.nickname },
    ...(data.productId
      ? [
          {
            key: '문의 상품',
            value: (
              <span title={data.productId}>
                {productName ?? data.productId}
              </span>
            ),
          },
        ]
      : []),
    {
      key: '카테고리',
      value: data.category ? CATEGORY_LABELS[data.category] : '-',
    },
    {
      key: '비밀글',
      value: data.isSecret ? (
        <span className="flex items-center gap-1">
          <LockIcon className="h-4 w-4" /> 비밀글
        </span>
      ) : (
        '공개'
      ),
    },
    {
      key: '상태',
      value: data.deletedAt ? (
        <Badge variant="destructive">{STATUS_LABELS.deleted}</Badge>
      ) : (
        <Badge variant={data.status === 'answered' ? 'default' : 'secondary'}>
          {STATUS_LABELS[data.status]}
        </Badge>
      ),
    },
    { key: '작성일', value: new Date(data.createdAt).toLocaleString('ko-KR') },
  ];

  return (
    <article className="divide-y">
      <header className="p-4">
        <h2 className="text-lg font-semibold">{data.title}</h2>
      </header>
      <dl>
        {rows.map(({ key, value }) => (
          <div key={key} className="grid grid-cols-3 p-3">
            <dt className="text-sm font-medium text-gray-500">{key}</dt>
            <dd className="col-span-2 text-sm">{value ?? '-'}</dd>
          </div>
        ))}
      </dl>
      <section className="p-4">
        <h3 className="text-sm font-medium text-gray-500 mb-2">문의 내용</h3>
        <p className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded-md">
          {data.content}
        </p>
      </section>
      {imageUrls.length > 0 && (
        <section className="p-4">
          <h3 className="text-sm font-medium text-gray-500 mb-2">
            첨부파일 ({imageUrls.length}개)
          </h3>
          <ul className="flex flex-wrap gap-3">
            {imageUrls.map((url, index) => (
              <li key={url}>
                <button
                  type="button"
                  onClick={() => handleImageClick(index)}
                  className="cursor-pointer"
                >
                  <Image
                    width={96}
                    height={96}
                    src={url}
                    alt={`첨부 이미지 ${index + 1}`}
                    className="aspect-square object-cover rounded-md border hover:opacity-80 transition-opacity"
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={selectedIndex !== null}
        onOpenChange={() => setSelectedIndex(null)}
      >
        <DialogContent className="max-w-2xl p-4">
          <Carousel setApi={setCarouselApi} className="w-full">
            <CarouselContent>
              {imageUrls.map((url, index) => (
                <CarouselItem key={url}>
                  <div className="relative flex h-[70vh] w-full items-center justify-center">
                    <Image
                      fill
                      src={url}
                      alt={`첨부 이미지 ${index + 1}`}
                      className="object-contain"
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-2" />
            <CarouselNext className="right-2" />
          </Carousel>
        </DialogContent>
      </Dialog>
    </article>
  );
}

export function QuestionDetail({ questionId }: { questionId: string }) {
  return (
    <Container className="divide-y">
      <Header
        title="문의 상세"
        right={<QuestionDeleteButton questionId={questionId} />}
      />
      <Suspense
        fallback={
          <div className="flex justify-center p-4">
            <Spinner />
          </div>
        }
      >
        <QuestionDetailContent questionId={questionId} />
      </Suspense>
    </Container>
  );
}
