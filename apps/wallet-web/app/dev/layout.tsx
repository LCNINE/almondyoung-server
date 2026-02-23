import Link from 'next/link';
import { Toaster } from '@/components/ui/sonner';

export default function DevLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="min-h-screen bg-background">
        <nav className="border-b px-6 py-3 flex items-center gap-6 text-sm font-medium">
          <span className="text-muted-foreground font-mono text-xs bg-muted px-2 py-0.5 rounded">
            DEV
          </span>
          <Link href="/dev/store" className="hover:underline">
            테스트 상점
          </Link>
          <Link href="/dev/points" className="hover:underline">
            포인트 관리
          </Link>
        </nav>
        <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
      </div>
      <Toaster />
    </>
  );
}
