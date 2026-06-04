'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { CheckCircle2, RefreshCw, AlertCircle, ChevronLeft } from 'lucide-react';
import { CMS_BANKS, getBankName } from '@/lib/cms-banks';
import { CmsSignaturePad } from '@/components/cms-signature-pad';

interface BillingSetupFormProps {
  returnUrl: string;
  initialError?: string;
  mode?: 'initial';
}

export function BillingSetupForm({ returnUrl, initialError, mode }: BillingSetupFormProps) {
  const router = useRouter();
  // 'details' → 'consent' → 'signature' → done
  const [step, setStep] = useState<'details' | 'consent' | 'signature'>('details');
  const [consentPersonalInfo, setConsentPersonalInfo] = useState(false);
  const [consentThirdParty, setConsentThirdParty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [done, setDone] = useState(false);
  const [agreementUploadFailed, setAgreementUploadFailed] = useState(false);

  const [paymentCompany, setPaymentCompany] = useState('');
  const [payerName, setPayerName] = useState('');
  const [payerNumber, setPayerNumber] = useState('');
  const [paymentNumber, setPaymentNumber] = useState('');

  const handleDetailsSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
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
    formData.append('file', blob, 'signature.png');
    try {
      const res = await fetch('/api/billing/cms-register-with-agreement', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await res.json().catch(() => ({})) as { error?: string; agreementUploadFailed?: boolean };
      if (!res.ok) {
        setError(data.error ?? '계좌 등록에 실패했습니다. 정보를 다시 확인해주세요.');
        setStep('details');
        return;
      }
      if (data.agreementUploadFailed) {
        setAgreementUploadFailed(true);
      }
      setDone(true);
    } catch {
      setError('계좌 등록 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
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
                  계좌 등록이 접수되었습니다
                </p>
                <p className={`mt-1 text-xs ${agreementUploadFailed ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {agreementUploadFailed
                    ? '동의자료 등록에 실패했습니다. 관리자가 수동으로 처리해야 정기결제가 가능해집니다. 고객센터에 문의해주세요.'
                    : '효성 CMS 심사 후 1~2 영업일 내 최종 확정됩니다. 등록 완료 시 정기결제가 자동으로 시작됩니다.'}
                </p>
              </div>
            </CardContent>
          </Card>
          <Button onClick={() => router.replace(returnUrl)} className="w-full h-11 font-semibold">
            확인
          </Button>
        </div>
      </div>
    );
  }

  if (step === 'consent') {
    const bankName = getBankName(paymentCompany);
    const allConsented = consentPersonalInfo && consentThirdParty;
    return (
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
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
                <div className="flex justify-between"><span className="text-muted-foreground">금융기관</span><span>{bankName}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">예금주</span><span>{payerName}</span></div>
              </div>

              {/* 개인정보 수집·이용 동의 */}
              <div className="space-y-2">
                <p className="text-xs font-semibold">[필수] 개인정보 수집·이용 동의</p>
                <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground space-y-1">
                  <p>아몬드영은 CMS 자동이체 서비스 제공을 위해 아래와 같이 개인정보를 수집·이용합니다.</p>
                  <table className="w-full mt-1 text-[10px]">
                    <tbody>
                      <tr><td className="font-medium w-24 py-0.5 align-top">수집·이용 목적</td><td>CMS 자동이체 서비스 신청 및 처리</td></tr>
                      <tr><td className="font-medium py-0.5 align-top">수집 항목</td><td>예금주명, 생년월일(사업자등록번호), 금융기관명, 계좌번호</td></tr>
                      <tr><td className="font-medium py-0.5 align-top">보유·이용 기간</td><td>서비스 해지 후 5년</td></tr>
                    </tbody>
                  </table>
                  <p className="mt-1">동의를 거부할 권리가 있으나, 거부 시 자동이체 서비스 이용이 제한됩니다.</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={consentPersonalInfo}
                    onCheckedChange={(v) => setConsentPersonalInfo(!!v)}
                  />
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
                      <tr><td className="font-medium w-24 py-0.5 align-top">제공받는 자</td><td>효성에프엠에스㈜, 금융결제원</td></tr>
                      <tr><td className="font-medium py-0.5 align-top">제공 목적</td><td>CMS 출금이체 서비스 처리 및 정산</td></tr>
                      <tr><td className="font-medium py-0.5 align-top">제공 항목</td><td>예금주명, 생년월일(사업자등록번호), 금융기관명, 계좌번호</td></tr>
                      <tr><td className="font-medium py-0.5 align-top">보유 기간</td><td>서비스 해지 후 5년</td></tr>
                    </tbody>
                  </table>
                  <p className="mt-1">동의를 거부할 권리가 있으나, 거부 시 자동이체 서비스 이용이 제한됩니다.</p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={consentThirdParty}
                    onCheckedChange={(v) => setConsentThirdParty(!!v)}
                  />
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
      <div className="min-h-screen bg-muted/40 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Card className="shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setStep('consent'); setError(null); }}
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
        {mode !== 'initial' && (
          <Card className="border-emerald-200 bg-emerald-50/50 shadow-sm">
            <CardContent className="flex items-start gap-3 p-4">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <p className="text-sm font-semibold text-emerald-800">첫 달 결제가 완료되었습니다!</p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  아래 계좌를 등록하면 다음 달부터 자동으로 출금됩니다.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="mb-5 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">자동이체 계좌 등록</h2>
            </div>
            <p className="mb-5 text-xs text-muted-foreground">
              계좌 정보 입력 후 전자서명 단계가 있습니다.
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
                다음 (전자서명)
              </Button>
            </form>

            {mode !== 'initial' && (
              <button
                type="button"
                onClick={() => router.replace(returnUrl)}
                disabled={loading}
                className="mt-4 w-full text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline transition-colors disabled:opacity-50"
              >
                나중에 등록하기 (건너뛰기)
              </button>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          계좌 정보는 암호화되어 효성 CMS에 안전하게 전송됩니다
        </p>
      </div>
    </div>
  );
}
