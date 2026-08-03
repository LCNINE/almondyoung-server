import { Link } from '@tanstack/react-router';
import { Button } from './Button';

export function PlaceholderScreen({ title, note }: { title: string; note?: string }) {
  return (
    <div className="space-y-4">
      <Link to="/">
        <Button>← 홈</Button>
      </Link>
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
        <p className="mt-2 text-sm text-gray-500">{note ?? '준비 중입니다.'}</p>
      </div>
    </div>
  );
}
