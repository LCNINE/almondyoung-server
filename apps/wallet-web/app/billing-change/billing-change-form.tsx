'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CreditCard, AlertCircle, CheckCircle2, ChevronLeft } from 'lucide-react';
import { CMS_BANKS } from '@/lib/cms-banks';
import { CmsSignaturePad } from '@/components/cms-signature-pad';

interface BillingChangeFormProps {
  returnUrl: string;
  billingMethodId?: string;
  initialError?: string;
}

export function BillingChangeForm({ returnUrl, billingMethodId, initialError }: BillingChangeFormProps) {
  const router = useRouter();
  const isRegister = !billingMethodId;
  // register: 'details' → 'signature' → done
  // update:   'details' → 'signature' → done
  const [step, setStep] = useState<'details' | 'signature'>('details');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [done, setDone] = useState(false);
  const [agreementUploadFailed, setAgreementUploadFailed] = useState(false);

  const [paymentCompany, setPaymentCompany] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerNumber, setPayerNumber] = useState('');
  const [paymentNumber, setPaymentNumber] = useState('');

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

  const handleDetailsSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setStep('signature');
  };

  const handleSignatureComplete = async (blob: Blob) => {
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('paymentCompany', paymentCompany);
    formData.append('payerName', payerName);
    formData.append('payerNumber', payerNumber);
    formData.append('paymentNumber', paymentNumber);
    formData.append('file', blob, 'signature.png');
    try {
      const url = isRegister
        ? '/api/billing/cms-register-with-agreement'
        : `/api/billing/cms-update-with-agreement/${billingMethodId}`;
      const method = isRegister ? 'POST' : 'PUT';
      const res = await fetch(url, { method, credentials: 'include', body: formData });
      const data = await res.json().catch(() => ({})) as { error?: string; agreementUploadFailed?: boolean };
      if (!res.ok) {
        setError(data.error ?? (isRegister ? '계좌 등록에 실패했습니다.' : '계좌 변경에 실패했습니다.'));
        setStep('details');
        return;
      }
      if (data.agreementUploadFailed) {
        setAgreementUploadFailed(true);
      }
      setDone(true);
    } catch {
      setError(isRegister ? '계좌 등록 중 오류가 발생했습니다.' : '계좌 변경 중 오류가 발생했습니다.');
      setStep('details');
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Card className={agreementUploadFailed ? 'border-amber-200 bg-amber-50/50 shadow-sm' : 'border-emerald-200 bg-emerald-50/50 shadow-sm'}>
            <CardContent className="flex items-start gap-3 p-6">
              <CheckCircle2 className={`mt-0.5 h-5 w-5 shrink-0 ${agreementUploadFailed ? 'text-amber-500' : 'text-emerald-500'}`} />
              <div>
                <p className={`text-sm font-semibold ${agreementUploadFailed ? 'text-amber-800' : 'text-emerald-800'}`}>
                  {isRegister ? '계좌 등록이 접수되었습니다' : '계좌 변경이 접수되었습니다'}
                </p>
                <p className={`mt-1 text-xs ${agreementUploadFailed ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {agreementUploadFailed
                    ? '동의자료 등록에 실패했습니다. 관리자가 수동으로 처리해야 정기결제가 가능해집니다. 고객센터에 문의해주세요.'
                    : `효성 CMS 심사 후 1~2 영업일 내 최종 확정됩니다.${isRegister ? ' 등록 완료 시 정기결제가 자동으로 시작됩니다.' : ' 다음 결제부터 새 계좌로 자동 출금됩니다.'}`}
                </p>
              </div>
            </CardContent>
          </Card>
          <Button onClick={() => router.replace(returnUrlWithFlag)} className="w-full h-11 font-semibold">
            확인
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'signature') {
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Card className="shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setStep('details'); setError(null); }}
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  aria-label="이전 단계로"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <h2 className="text-sm font-semibold">전자서명</h2>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                자동이체 동의서에 서명해주세요. 서명 이미지는 효성 CMS에 동의자료로 제출되며,
                미제출 시 심사에서 실패할 수 있습니다.
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
    <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                {isRegister ? '자동이체 계좌 등록' : '정기결제 계좌 변경'}
              </h2>
            </div>
            <p className="mb-5 text-xs text-muted-foreground">
              {isRegister
                ? '등록한 계좌로 정기결제가 자동 출금됩니다. 계좌 정보 입력 후 전자서명 단계가 있습니다.'
                : '새로 등록한 계좌로 다음 결제부터 자동 출금됩니다. 계좌 변경 시 기존 동의자료가 무효화되므로 전자서명 단계가 있습니다.'}
            </p>

            <form onSubmit={handleDetailsSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="paymentCompany" className="text-xs text-muted-foreground">은행</Label>
                <select
                  id="paymentCompany"
                  value={paymentCompany}
                  onChange={(e) => setPaymentCompany(e.target.value)}
                  required
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">은행 선택</option>
                  {CMS_BANKS.map((b) => (
                    <option key={b.code} value={b.code}>{b.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payerName" className="text-xs text-muted-foreground">예금주명</Label>
                <Input
                  id="payerName"
                  placeholder="홍길동"
                  value={payerName}
                  onChange={(e) => setPayerName(e.target.value)}
                  maxLength={15}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="paymentNumber" className="text-xs text-muted-foreground">계좌번호</Label>
                <Input
                  id="paymentNumber"
                  placeholder="숫자만 입력"
                  value={paymentNumber}
                  onChange={(e) => setPaymentNumber(e.target.value.replace(/\D/g, '').slice(0, 16))}
                  inputMode="numeric"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payerNumber" className="text-xs text-muted-foreground">
                  생년월일 (개인 6자리) 또는 사업자번호 (법인 10자리)
                </Label>
                <Input
                  id="payerNumber"
                  placeholder="개인: YYMMDD · 법인: 사업자번호"
                  value={payerNumber}
                  onChange={(e) => setPayerNumber(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  inputMode="numeric"
                  required
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-xs">{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={loading} className="w-full h-11 font-semibold">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    처리 중...
                  </span>
                ) : (
                  '다음 (전자서명)'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {(
          <p className="text-center text-xs text-muted-foreground">
            계좌 정보는 암호화되어 효성 CMS에 안전하게 전송됩니다
          </p>
        )}
      </div>
    </div>
  );
}
