'use client';

import { useRouter } from 'next/navigation';

const IconChevronLeft = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12.79 5.23a.75.75 0 010 1.06L9.06 10l3.73 3.71a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0z"
      clipRule="evenodd"
    />
  </svg>
);

export function BackButton() {
  const router = useRouter();
  return (
    <button aria-label="뒤로 가기" className="-m-2 p-2 text-black" onClick={() => router.back()}>
      <IconChevronLeft />
    </button>
  );
}
