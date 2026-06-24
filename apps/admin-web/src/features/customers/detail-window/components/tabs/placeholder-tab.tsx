'use client';

// 아직 구현 전인 탭. 단계별로 채워 나간다.
export function PlaceholderTab({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-gray-400">
      {title} — 준비 중
    </div>
  );
}
