'use client';

import { useEffect, useState } from 'react';
import { CmsAccountDetails, CmsAccountFields, emptyCmsAccountDetails } from '@/components/cms-account-fields';

/**
 * 계좌 등록 입력 UI 미리보기. 로그인 가드도 dev 레이아웃도 없어 실기기(아이폰 등)에서
 * 실제 화면과 같은 조건으로 열린다 — 키보드가 올라올 때 버튼·포커스·스크롤을 보려고 만들었다.
 *
 * 조회 API 는 세션이 없으면 401 이고, 그러면 컴포넌트가 「확인 불가」로 넘겨버려 에러 UI 를
 * 볼 수 없다. 그래서 이 페이지에서만 fetch 를 가로채 가짜 응답을 준다. 제품 코드는 그대로다.
 */
const MOCK_RULES = [
  { when: '생년월일 010101', then: '2001 생년월일 불일치 → 생년월일 칸으로' },
  { when: '계좌번호 ...0000', then: '1001 계좌번호 오류 → 계좌번호 칸으로' },
  { when: '계좌번호 ...9999', then: '확인 불가 → 경고만, 진행 가능' },
  { when: '그 외', then: '통과, 예금주 “김아몬드”' },
];

function useMockedAccountCheck() {
  useEffect(() => {
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : ((input as Request).url ?? '');
      if (!url.includes('cms-check-account')) return original(input, init);

      const raw = typeof init?.body === 'string' ? init.body : '{}';
      const body = JSON.parse(raw) as { paymentNumber?: string; payerNumber?: string };
      const account = body.paymentNumber ?? '';
      await new Promise((r) => setTimeout(r, 600));

      const reply = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
      if (account.endsWith('9999')) {
        return reply({
          verified: false,
          payerName: null,
          reason: 'UNAVAILABLE',
          message: '지금은 계좌를 실시간으로 확인할 수 없습니다.',
          providerCode: '500',
        });
      }
      if (body.payerNumber === '010101') {
        return reply({
          verified: false,
          payerName: null,
          reason: 'MISMATCH',
          message: '계좌에 등록된 생년월일(사업자번호)과 다릅니다. 계좌를 만들 때 쓴 정보로 입력해주세요.',
          providerCode: '2001',
        });
      }
      if (account.endsWith('0000')) {
        return reply({
          verified: false,
          payerName: null,
          reason: 'MISMATCH',
          message: '계좌번호를 다시 확인해주세요. 해당 은행에 그런 계좌번호가 없습니다.',
          providerCode: '1001',
        });
      }
      return reply({ verified: true, payerName: '김아몬드', reason: null, message: null, providerCode: null });
    };
    return () => {
      window.fetch = original;
    };
  }, []);
}

export default function AccountPreviewPage() {
  const [details, setDetails] = useState<CmsAccountDetails>(emptyCmsAccountDetails);
  const [done, setDone] = useState(false);
  useMockedAccountCheck();

  if (done) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg font-bold">입력 단계를 통과했습니다</p>
        <pre className="w-full overflow-x-auto rounded-xl bg-muted p-4 text-left text-xs">
          {JSON.stringify(details, null, 2)}
        </pre>
        <div className="w-full rounded-xl bg-muted/60 p-4 text-left text-[11px] leading-relaxed text-muted-foreground">
          <p className="mb-1 font-semibold text-foreground">미리보기 규칙 (가짜 응답)</p>
          {MOCK_RULES.map((r) => (
            <p key={r.when}>
              <span className="font-medium">{r.when}</span> → {r.then}
            </p>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setDetails(emptyCmsAccountDetails);
            setDone(false);
          }}
          className="text-sm text-muted-foreground underline"
        >
          처음부터 다시
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <CmsAccountFields value={details} onChange={setDetails} onComplete={() => setDone(true)} />
    </div>
  );
}
