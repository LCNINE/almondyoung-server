'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertCircle, Check, ChevronLeft, Info } from 'lucide-react';
import { getBankName } from '@/lib/cms-banks';
import { CmsSignaturePad } from '@/components/cms-signature-pad';
import { CmsAccountDetails, CmsAccountFields, emptyCmsAccountDetails } from '@/components/cms-account-fields';
import { buildReturnUrl } from '@/lib/return-url';

interface BillingChangeFormProps {
  returnUrl: string;
  billingMethodId?: string;
  initialError?: string;
}

export function BillingChangeForm({ returnUrl, billingMethodId, initialError }: BillingChangeFormProps) {
  const router = useRouter();
  const isRegister = !billingMethodId;
  // register: 'details' → 'consent' → 'signature' → done
  // update:   'details' → 'consent' → 'signature' → done
  const [step, setStep] = useState<'details' | 'consent' | 'signature'>('details');
  const [consentPersonalInfo, setConsentPersonalInfo] = useState(false);
  const [consentThirdParty, setConsentThirdParty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [done, setDone] = useState(false);
  const [agreementUploadFailed, setAgreementUploadFailed] = useState(false);
  // 신규 등록 시 백엔드가 반환한 새 결제수단 id — 복귀 후 선적용 자동가입이 이 수단을 쓰도록 returnUrl 에 싣는다.
  const [newBillingMethodId, setNewBillingMethodId] = useState<string | null>(null);

  const [details, setDetails] = useState<CmsAccountDetails>(emptyCmsAccountDetails);
  const { paymentCompany, payerName, payerNumber, paymentNumber, phone } = details;

  const returnUrlWithFlag = (() => {
    try {
      const url = new URL(returnUrl);
      url.searchParams.set('cardChanged', '1');
      return url.toString();
    } catch {
      const sep = returnUrl.includes('?') ? '&' : '?';
      return `${returnUrl}${sep}cardChanged=1`;
    }
  })();

  const goToConsent = () => {
    setError(null);
    setConsentPersonalInfo(false);
    setConsentThirdParty(false);
    setStep('consent');
  };

  const handleSignatureComplete = async (blob: Blob) => {
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('paymentCompany', paymentCompany);
    formData.append('payerName', payerName);
    formData.append('payerNumber', payerNumber);
    formData.append('paymentNumber', paymentNumber);
    formData.append('phone', phone);
    formData.append('file', blob, 'signature.png');
    try {
      const url = isRegister
        ? '/api/billing/cms-register-with-agreement'
        : `/api/billing/cms-update-with-agreement/${billingMethodId}`;
      const method = isRegister ? 'POST' : 'PUT';
      const res = await fetch(url, { method, credentials: 'include', body: formData });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        agreementUploadFailed?: boolean;
        id?: string;
      };
      if (!res.ok) {
        setError(data.error ?? (isRegister ? '계좌 등록에 실패했습니다.' : '계좌 변경에 실패했습니다.'));
        setStep('details');
        return;
      }
      if (data.agreementUploadFailed) {
        setAgreementUploadFailed(true);
      }
      // 신규 등록 응답의 새 id 만 실어 보낸다(변경은 기존 수단이라 auto-subscribe 가 이미 알고 있음).
      if (isRegister && data.id) setNewBillingMethodId(data.id);
      setDone(true);
    } catch {
      setError(isRegister ? '계좌 등록 중 오류가 발생했습니다.' : '계좌 변경 중 오류가 발생했습니다.');
      setStep('details');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    const goBack = () =>
      router.replace(
        newBillingMethodId
          ? buildReturnUrl(returnUrlWithFlag, { billingMethodId: newBillingMethodId })
          : returnUrlWithFlag,
      );
    // 뒤 4자리만 남긴다 — 「내가 등록한 그 계좌가 맞나」를 확인하는 데는 그걸로 충분하다.
    const maskedAccount =
      paymentNumber.length > 4 ? `${'•'.repeat(paymentNumber.length - 4)}${paymentNumber.slice(-4)}` : paymentNumber;
    const rows = [
      { label: '은행', value: getBankName(paymentCompany) },
      { label: '계좌번호', value: maskedAccount },
      { label: '예금주', value: payerName },
      { label: '은행 심사', value: '1~2 영업일' },
    ];

    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background">
        <div className="flex-1 px-6 pt-16">
          <div className="flex flex-col items-center">
            <span
              className={`flex size-14 items-center justify-center rounded-full ${
                agreementUploadFailed ? 'bg-muted-foreground' : 'bg-primary'
              }`}
            >
              <Check className="size-7 text-primary-foreground" strokeWidth={3} />
            </span>
            <h1 className="mt-5 text-[22px] font-bold tracking-tight text-foreground">
              {agreementUploadFailed ? '계좌 등록 확인 필요' : isRegister ? '계좌 등록 완료' : '계좌 변경 완료'}
            </h1>
          </div>

          <dl className="mt-9">
            {rows.map((row) => (
              <div key={row.label} className="flex items-center justify-between border-b border-border py-4">
                <dt className="text-[14px] text-muted-foreground">{row.label}</dt>
                <dd className="text-[15px] font-bold tracking-tight text-foreground">{row.value}</dd>
              </div>
            ))}
          </dl>

          {/* 「은행 문자 = 승인 완료」로 오해하고 문의하는 일이 실제로 잦다. 다른 안내와 같은
              불릿에 섞어두면 안 읽히므로 한 줄만 떼어 면으로 세운다. */}
          {!agreementUploadFailed && (
            <div className="mt-7 flex items-start gap-2.5 rounded-xl bg-muted p-4">
              <Info className="mt-0.5 size-4 shrink-0 text-primary" />
              <p className="text-[13px] leading-relaxed text-foreground">
                은행에서 오는 <span className="font-bold">‘자동이체 등록 접수’ 문자는 최종 승인이 아닙니다.</span> 최종
                결과는 결제수단 관리 화면에서 확인해주세요.
              </p>
            </div>
          )}

          {/* 여기까지 온 이유는 «멤버십 가입 중 결제수단이 없어서» 다. 다음 할 일이 그 가입을
              마치는 것이라는 걸 맨 앞에 둔다 — 안내문 여러 줄 안에 묻어두면 읽히지 않는다. */}
          <ul className="mt-5 space-y-2 text-[13px] leading-relaxed text-muted-foreground">
            {agreementUploadFailed ? (
              <li>· 동의자료 등록에 실패했습니다. 관리자 확인이 필요하니 고객센터로 문의해주세요.</li>
            ) : (
              <li>
                ·{' '}
                {isRegister
                  ? '이어서 멤버십 가입을 마무리하면, 심사 승인과 함께 결제가 자동으로 출금됩니다.'
                  : '심사가 끝나면 다음 결제부터 새 계좌로 자동 출금됩니다.'}
              </li>
            )}
          </ul>
        </div>

        <footer className="shrink-0 px-5 pb-[calc(1rem_+_env(safe-area-inset-bottom))] pt-3">
          <Button onClick={goBack} className="h-14 w-full rounded-2xl text-[16px] font-semibold">
            {agreementUploadFailed ? '확인' : isRegister ? '멤버십 가입 계속하기' : '확인'}
          </Button>
        </footer>
      </div>
    );
  }

  if (step === 'consent') {
    const bankName = getBankName(paymentCompany);
    const allConsented = consentPersonalInfo && consentThirdParty;
    return (
      <div className="min-h-dvh bg-muted/40 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Card className="shadow-sm">
            <CardContent className="p-6 space-y-5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('details')}
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  aria-label="이전 단계로"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="text-sm font-semibold">자동이체 동의</h2>
              </div>

              {/* 출금 계좌 확인 */}
              <div className="rounded-md bg-muted/60 px-4 py-3 text-xs space-y-1">
                <p className="font-semibold text-foreground mb-1.5">출금 계좌 확인</p>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">금융기관</span>
                  <span>{bankName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">예금주</span>
                  <span>{payerName}</span>
                </div>
              </div>

              {/* 개인정보 수집·이용 동의 */}
              <div className="space-y-2">
                <p className="text-xs font-semibold">[필수] 개인정보 수집·이용 동의</p>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground space-y-1">
                  <p>아몬드영은 CMS 자동이체 서비스 제공을 위해 아래와 같이 개인정보를 수집·이용합니다.</p>
                  <table className="w-full mt-1 text-[10px]">
                    <tbody>
                      <tr>
                        <td className="font-medium w-24 py-0.5 align-top">수집·이용 목적</td>
                        <td>CMS 자동이체 서비스 신청 및 처리</td>
                      </tr>
                      <tr>
                        <td className="font-medium py-0.5 align-top">수집 항목</td>
                        <td>예금주명, 연락처, 생년월일(사업자등록번호), 금융기관명, 계좌번호</td>
                      </tr>
                      <tr>
                        <td className="font-medium py-0.5 align-top">보유·이용 기간</td>
                        <td>서비스 해지 후 5년</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-1">동의를 거부할 권리가 있으나, 거부 시 자동이체 서비스 이용이 제한됩니다.</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={consentPersonalInfo} onCheckedChange={(v) => setConsentPersonalInfo(!!v)} />
                  <span className="text-xs">개인정보 수집·이용에 동의합니다.</span>
                </label>
              </div>

              {/* 개인정보 제3자 제공 동의 */}
              <div className="space-y-2">
                <p className="text-xs font-semibold">[필수] 개인정보 제3자 제공 동의</p>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground space-y-1">
                  <p>아몬드영은 CMS 자동이체 서비스 제공을 위해 아래와 같이 개인정보를 제3자에게 제공합니다.</p>
                  <table className="w-full mt-1 text-[10px]">
                    <tbody>
                      <tr>
                        <td className="font-medium w-24 py-0.5 align-top">제공받는 자</td>
                        <td>효성에프엠에스㈜, 금융결제원</td>
                      </tr>
                      <tr>
                        <td className="font-medium py-0.5 align-top">제공 목적</td>
                        <td>CMS 출금이체 서비스 처리 및 정산</td>
                      </tr>
                      <tr>
                        <td className="font-medium py-0.5 align-top">제공 항목</td>
                        <td>예금주명, 연락처, 생년월일(사업자등록번호), 금융기관명, 계좌번호</td>
                      </tr>
                      <tr>
                        <td className="font-medium py-0.5 align-top">보유 기간</td>
                        <td>서비스 해지 후 5년</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-1">동의를 거부할 권리가 있으나, 거부 시 자동이체 서비스 이용이 제한됩니다.</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={consentThirdParty} onCheckedChange={(v) => setConsentThirdParty(!!v)} />
                  <span className="text-xs">개인정보 제3자 제공에 동의합니다.</span>
                </label>
              </div>

              <Button
                className="w-full h-11 font-semibold"
                disabled={!allConsented}
                onClick={() => setStep('signature')}
              >
                서명하러 가기
              </Button>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground">
            계좌 정보는 암호화되어 효성 CMS에 안전하게 전송됩니다
          </p>
        </div>
      </div>
    );
  }

  if (step === 'signature') {
    return (
      <div className="min-h-dvh bg-muted/40 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Card className="shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setStep('consent');
                    setError(null);
                  }}
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  aria-label="이전 단계로"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="text-sm font-semibold">전자서명</h2>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                자동이체 동의서에 서명해주세요. 서명 이미지는 효성 CMS에 동의자료로 제출되며, 미제출 시 심사에서 실패할
                수 있습니다.
              </p>
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              )}
              <CmsSignaturePad onComplete={handleSignatureComplete} disabled={loading} />
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground">
            계좌 정보는 암호화되어 효성 CMS에 안전하게 전송됩니다
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md bg-background">
      {error && (
        <div className="px-5 pt-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-xs">{error}</AlertDescription>
          </Alert>
        </div>
      )}
      <CmsAccountFields value={details} onChange={setDetails} onComplete={goToConsent} />
    </div>
  );
}
