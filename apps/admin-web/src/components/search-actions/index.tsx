/** @format */

import { Button } from '@/components/ui/button';

export default function SearchActions({
  onSubmit,
  onReset,
}: {
  onSubmit?: () => void;
  onReset?: () => void;
}) {
  return (
    <>
      <Button
        type="submit"
        className="bg-[#F29219] text-white hover:bg-[#DF7B00] px-10 py-3 cursor-pointer"
        variant="default"
        onClick={() => onSubmit?.()}
      >
        검색
      </Button>
      <Button
        type="button"
        className="bg-white text-gray-700 hover:bg-gray-50 px-10 py-3 cursor-pointer"
        variant="outline"
        onClick={() => {
          onReset?.();
        }}
      >
        초기화
      </Button>
    </>
  );
}
