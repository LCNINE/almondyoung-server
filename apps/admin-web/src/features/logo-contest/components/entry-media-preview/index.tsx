'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel';
import { resolvePublicFileUrl } from '@/lib/utils/file-url';

export function EntryMediaPreview({
  title,
  mediaFileIds,
}: {
  title: string;
  mediaFileIds: string[];
}) {
  const [open, setOpen] = useState(false);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();

  const imageUrls = mediaFileIds
    .map((fileId) => resolvePublicFileUrl(fileId))
    .filter((url): url is string => !!url);

  useEffect(() => {
    if (open && carouselApi) carouselApi.scrollTo(0);
  }, [open, carouselApi]);

  if (imageUrls.length === 0) {
    return <span className="text-sm text-muted-foreground">이미지 없음</span>;
  }

  return (
    <>
      <button
        type="button"
        className="relative block size-16 cursor-pointer overflow-hidden rounded border bg-muted"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Image
          unoptimized
          fill
          src={imageUrls[0]}
          alt={`${title} 대표 이미지`}
          className="object-cover transition-opacity hover:opacity-80"
        />
        {imageUrls.length > 1 && (
          <span className="absolute bottom-0 right-0 bg-black/60 px-1 text-[10px] text-white">
            {imageUrls.length}
          </span>
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl p-4"
          onClick={(event) => event.stopPropagation()}
          onKeyDownCapture={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'ArrowLeft') carouselApi?.scrollPrev();
            else carouselApi?.scrollNext();
          }}
        >
          <Carousel setApi={setCarouselApi} className="w-full">
            <CarouselContent>
              {imageUrls.map((url, index) => (
                <CarouselItem key={url}>
                  <div className="relative flex h-[70vh] w-full items-center justify-center">
                    <Image
                      unoptimized
                      fill
                      src={url}
                      alt={`${title} 이미지 ${index + 1}`}
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
    </>
  );
}
