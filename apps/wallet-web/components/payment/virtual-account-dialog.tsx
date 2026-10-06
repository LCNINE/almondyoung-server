'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import Image from 'next/image';
import type { BusinessLicenseInfo } from '@/lib/wallet-api';
import { SheetSelect } from '@/components/ui/sheet-select';

const BANKS = [
  { name: '국민', logo: 'kb' },
  { name: '농협', logo: 'nh' },
  { name: '신한', logo: 'shinhan' },
  { name: '우리', logo: 'woori' },
  { name: '하나', logo: 'hana' },
  { name: '기업', logo: 'ibk' },
  { name: '부산', logo: 'busan' },
  { name: '경남', logo: 'bnk' },
  { name: '광주', logo: 'kwangju' },
  { name: '전북', logo: 'jb' },
  { name: '수협', logo: 'suhyup' },
  { name: '우체국', logo: 'postoffice' },
  { name: 'iM뱅크', logo: 'dgb' },
];
const field = 'mt-2 h-12 w-full rounded-lg border border-border bg-white px-3 outline-none focus:border-foreground/40';

/** 가상계좌 계약 반영 전 UI. 실제 계좌번호·입금기한은 서버 발급 결과로만 표시해야 한다. */
export function VirtualAccountDialog({
  customer,
  open,
  onOpenChange,
  orderName,
  amount,
}: {
  customer?: BusinessLicenseInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderName: string;
  amount: number;
}) {
  const [bank, setBank] = useState<string | null>(null);
  const [receipt, setReceipt] = useState('DEDUCTION');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-6 sm:max-w-[720px] sm:p-8"
        onFocusOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => {
          const target = event.target;
          if (
            target instanceof Element &&
            target.closest('[data-slot="drawer-content"], [data-slot="drawer-overlay"]')
          ) {
            event.preventDefault();
          }
        }}
      >
        <DialogTitle className="pr-8 text-lg font-bold">무통장입금</DialogTitle>
        <DialogDescription className="sr-only">입금 은행을 선택하고 입금 정보를 입력하세요.</DialogDescription>
        {!bank ? (
          <div className="py-6 sm:px-16">
            <h2 className="text-2xl font-bold tracking-tight">입금할 은행을 선택해주세요</h2>
            <p className="mt-2 text-sm text-muted-foreground">{orderName}</p>
            <div className="mt-7 grid grid-cols-3 gap-2">
              {BANKS.map(({ name, logo }) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setBank(name)}
                  className="flex min-h-20 flex-col items-center justify-center gap-2 py-3 rounded-xl bg-[#f5f6f8] text-sm font-semibold hover:bg-[#eceef1] focus-visible:outline-2 focus-visible:outline-foreground/40"
                >
                  <Image src={`/banks/${logo}.png`} alt="" width={28} height={28} className="size-7 object-contain" />
                  {name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-7 pt-4 sm:grid-cols-[1fr_1.35fr]">
            <section aria-label="입금 요약">
              <h2 className="text-2xl font-bold leading-relaxed tracking-tight">
                {bank === '우체국' || bank === 'iM뱅크' ? bank : `${bank}은행`}으로
                <br />
                {amount.toLocaleString('ko-KR')}원<br />
                무통장입금
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">{orderName}</p>
              <button
                type="button"
                onClick={() => setBank(null)}
                className="mt-5 rounded-lg bg-muted px-3 py-2 text-sm font-medium"
              >
                입금 은행 변경
              </button>
            </section>
            <div className="space-y-5">
              <label className="block text-sm font-medium">
                입금자명
                <input defaultValue={customer?.username ?? ''} autoComplete="name" className={field} />
              </label>
              <label className="block text-sm font-medium">
                휴대폰번호 <span className="font-normal text-muted-foreground">선택</span>
                <input defaultValue={customer?.phoneNumber ?? ''} type="tel" autoComplete="tel" className={field} />
              </label>
              <label className="block text-sm font-medium">
                이메일 <span className="font-normal text-muted-foreground">선택</span>
                <input defaultValue={customer?.email ?? ''} type="email" autoComplete="email" className={field} />
              </label>
              <div className="text-sm font-medium">
                <p className="mb-2">현금영수증</p>
                <SheetSelect
                  title="현금영수증"
                  value={receipt}
                  onChange={setReceipt}
                  options={[
                    { value: 'DEDUCTION', label: '소득공제용(휴대폰)' },
                    { value: 'PROOF', label: '지출증빙용(사업자번호)' },
                    { value: 'NONE', label: '신청 안 함' },
                  ]}
                  triggerClassName="flex h-12 w-full items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 text-left text-sm font-normal outline-none focus-visible:border-foreground/40"
                />
              </div>
              {receipt !== 'NONE' && (
                <label className="block text-sm font-medium">
                  {receipt === 'PROOF' ? '사업자등록번호' : '현금영수증 휴대폰번호'}
                  <input
                    key={receipt}
                    defaultValue={
                      receipt === 'PROOF' ? (customer?.businessNumber ?? '') : (customer?.phoneNumber ?? '')
                    }
                    inputMode="numeric"
                    className={field}
                    placeholder={receipt === 'PROOF' ? '사업자등록번호 10자리' : '휴대폰번호를 입력해주세요'}
                  />
                </label>
              )}
              <p role="status" className="text-sm leading-relaxed text-muted-foreground">
                무통장입금 서비스 준비 중입니다. 계약 반영 후 계좌를 발급받을 수 있습니다.
              </p>
              <Button disabled className="h-12 w-full rounded-lg">
                입금 계좌 발급 준비 중
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
