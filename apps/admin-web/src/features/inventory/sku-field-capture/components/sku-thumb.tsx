'use client';

import { useState } from 'react';
import { ImageIcon, ImageOff } from 'lucide-react';

// 사진이 원래 없는 것과 주소는 있는데 못 불러온 것을 구분한다 — 뒤쪽은 셀메이트 이미지 주소가 깨졌다는 신호다
export function SkuThumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);

  if (!src) {
    return (
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg bg-gray-100 text-[10px] text-gray-400">
        <ImageIcon className="h-4 w-4" />
        사진 없음
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-gray-300 bg-white text-[10px] text-gray-500">
        <ImageOff className="h-4 w-4" />
        불러오기 실패
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- 셀메이트 외부 이미지, next/image 도메인 설정 밖
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover"
    />
  );
}
