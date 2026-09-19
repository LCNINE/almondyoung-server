'use client';

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from '@/components/ui/carousel';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { QuickActionsEditDialog } from './QuickActionsEditDialog';
import { useQuickActions } from './useQuickActions';

export function QuickActionsCard() {
  const { visibleActions, pref, savePref, isReady } = useQuickActions();
  const [editOpen, setEditOpen] = useState(false);

  return (
    <section className="rounded-2xl bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_0_2px_rgba(0,0,0,0.05)]">
      <Carousel opts={{ align: 'start', slidesToScroll: 'auto' }}>
        <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-1.5">
          <h2 className="text-base font-bold text-[#1C1C1C]">주요 서비스</h2>
          <div className="flex items-center gap-3">
            <div className="flex gap-1 [&:not(:has(:enabled))]:hidden">
              <CarouselPrevious className="static size-7 translate-y-0 cursor-pointer" />
              <CarouselNext className="static size-7 translate-y-0 cursor-pointer" />
            </div>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              disabled={!isReady}
              className="cursor-pointer text-[13px] text-[#1779BA] hover:underline disabled:cursor-default disabled:opacity-50"
            >
              편집
            </button>
          </div>
        </div>
        <div className="px-4 pb-4">
          {visibleActions.length === 0 ? (
            <p className="py-3 text-center text-[13px] text-gray-400">
              표시할 서비스가 없어요. 편집에서 추가해 보세요.
            </p>
          ) : (
            <CarouselContent className="-ml-2">
              {visibleActions.map((action) => {
                return (
                  <CarouselItem
                    key={action.id}
                    className="basis-1/2 pl-2 md:basis-1/3 xl:basis-1/4"
                  >
                    <Link
                      href={action.path}
                      className="flex h-12 items-center gap-2 rounded-lg bg-[#FAFAFA] px-4 transition-colors hover:bg-[#F2F2F2]"
                    >
                      <span className="flex-1 truncate text-sm font-medium text-[#1C1C1C]">
                        {action.label}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[#BDBDBD]" />
                    </Link>
                  </CarouselItem>
                );
              })}
            </CarouselContent>
          )}
        </div>
      </Carousel>

      <QuickActionsEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        pref={pref}
        onSave={savePref}
      />
    </section>
  );
}
