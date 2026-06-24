'use client';

import DaumPostcodeEmbed, { type Address } from 'react-daum-postcode';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AddressSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (address: { zipcode: string; address: string }) => void;
  title?: string;
}

// Daum(카카오) 우편번호 서비스. 키·도메인 등록 불필요한 클라이언트 위젯.
// onSelect 시그니처는 기존(epost) 버전과 동일하게 유지 — 호출부 변경 없음.
export function AddressSearchDialog({
  open,
  onOpenChange,
  onSelect,
  title = '주소 검색',
}: AddressSearchDialogProps) {
  const handleComplete = (data: Address) => {
    // 사용자가 지번 탭에서 골랐으면 지번주소, 아니면 도로명주소.
    const address =
      data.userSelectedType === 'J' ? data.jibunAddress : data.roadAddress;
    onSelect({ zipcode: data.zonecode, address: address || data.address });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0">
        <DialogHeader className="px-6 pb-2 pt-6">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {open && (
          <DaumPostcodeEmbed
            onComplete={handleComplete}
            autoClose={false}
            style={{ height: 470 }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
