import type { LucideIcon } from 'lucide-react';

/** 프레젠테이션 타일 본문. 네비게이션은 호출부에서 <Link>로 감싼다. */
export function HubTile({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white p-5 text-center shadow-sm active:bg-gray-50">
      <Icon className="h-7 w-7 text-blue-600" aria-hidden />
      <span className="text-sm font-semibold text-gray-800">{label}</span>
    </div>
  );
}

export function TileGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
