'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { useBulkIssueCoupon } from '@/lib/services/coupons';
import { customerApi } from '@/lib/api/domains/customer';
import { medusaCustomerApi } from '@/lib/api/domains/medusa';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { skipReasonLabel } from '../lib/skip-reason-labels';
import {
  parseIssueTargets,
  summarizeIssueResult,
  type ResolvedTarget,
  type IssueSummary,
} from '../lib/parse-issue-targets';
import { classifyLookupMatches } from '../lib/classify-lookup-matches';

export function CouponAssignDialog({
  promotionId,
  promotionCode,
  open,
  onOpenChange,
}: {
  promotionId: string;
  promotionCode: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [raw, setRaw] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [resolved, setResolved] = useState<ResolvedTarget[]>([]);
  const [unresolved, setUnresolved] = useState<{ input: string; reason: string }[]>([]);
  const [summary, setSummary] = useState<IssueSummary | null>(null);
  const [isResolving, setIsResolving] = useState(false);

  // 🔴 제출 식별자는 «제출 시작» 때 만들어 ref 에 보관한다. 실패 재시도는 같은 값을 쓰고,
  //    성공하면 버린다. 이게 없으면 타임아웃 후 재제출이 곧 두 배 발급이다.
  //    (버튼 disabled 는 방어가 아니다 — 렌더 사이 연타도, 네트워크 재시도도 못 막는다.)
  const submitIdRef = useRef<string | null>(null);

  const bulkIssue = useBulkIssueCoupon();

  const handleResolve = async () => {
    const targets = parseIssueTargets(raw);
    if (targets.length === 0) return;
    setIsResolving(true);
    const ok: ResolvedTarget[] = [];
    const bad: { input: string; reason: string }[] = [];

    for (const input of targets) {
      try {
        // 🔴 새 엔드포인트를 만들지 말 것 — `q` 하나가 loginId·email·username·nickname·전화를
        //    모두 ilike 검색한다(user-service `users.service.ts:66-70`). 이 클라이언트도 이미 있다.
        const users = await customerApi.getCustomersWithPagination({ q: input, limit: 2 });
        // 0건/1건/2건+ 판정은 `classify-lookup-matches.ts` 의 순수 함수가 한다 — `.tsx` 안에
        // 두면 admin-web jest 가 아예 실행하지 않는다(#488 Task 12 리뷰 Important #2).
        const outcome = classifyLookupMatches(users.data ?? []);
        if (outcome.kind === 'not_found') { bad.push({ input, reason: '회원을 찾을 수 없습니다' }); continue; }
        if (outcome.kind === 'ambiguous') { bad.push({ input, reason: '두 명 이상 일치합니다' }); continue; }

        const user = outcome.match;
        // `medusaCustomerApi.getCustomerByAlmondUserId` 도 이미 있다 — 새로 만들지 말 것.
        // almond_user_id 가 없는 계정은 여기서 404 다(연동 안 된 계정). 이메일로 다시
        // 시도하면 잡히는 경우가 있으므로 사유를 그렇게 안내한다.
        const customer = await medusaCustomerApi.getCustomerByAlmondUserId(user.id);
        ok.push({ input, customerId: customer.customer.id, label: `${user.loginId} (${user.email})` });
      } catch {
        bad.push({ input, reason: '쇼핑몰 계정과 연결되지 않았습니다 (이메일로 다시 시도해 보세요)' });
      }
    }
    setResolved(ok);
    setUnresolved(bad);
    setSummary(null);
    setIsResolving(false);
  };

  const handleIssue = async (force = false) => {
    if (resolved.length === 0) return;
    if (!submitIdRef.current) submitIdRef.current = crypto.randomUUID();

    try {
      const result = await bulkIssue.mutateAsync({
        promotionId,
        customerIds: resolved.map((r) => r.customerId),
        quantity,
        submitId: submitIdRef.current,
        force,
      });
      const s = summarizeIssueResult(result, resolved);
      setSummary(s);
      if (s.failed.length === 0) {
        toast.success(`${s.succeeded.length}명에게 ${s.grantedTotal}장 발급했습니다.`);
        submitIdRef.current = null; // 다음 제출은 새 키
      }
    } catch (e: unknown) {
      // 🔴 재시도는 같은 submitIdRef 를 쓴다 — 여기서 초기화하지 말 것.
      const msg = (e as any)?.response?.data?.message ?? '쿠폰 발급에 실패했습니다.';
      toast.error(msg);
    }
  };

  const handleClose = () => {
    setRaw('');
    setQuantity(1);
    setResolved([]);
    setUnresolved([]);
    setSummary(null);
    submitIdRef.current = null;
    onOpenChange(false);
  };

  const canIssue = resolved.length > 0 && !bulkIssue.isPending;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>쿠폰 발급</DialogTitle>
          <DialogDescription>
            쿠폰 <span className="font-mono font-semibold">{promotionCode}</span>을 여러 고객에게 발급합니다.
            로그인아이디 또는 이메일을 한 줄에 하나씩(또는 쉼표로 구분해) 입력하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>로그인아이디 / 이메일</Label>
            <Textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={'alice\nbob@example.com\ncarol'}
              rows={5}
            />
          </div>

          <div className="flex items-end gap-2">
            <div className="space-y-2">
              <Label>수량</Label>
              <Input
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                className="w-24"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleResolve}
              disabled={!raw.trim() || isResolving}
            >
              {isResolving ? '조회 중...' : '조회'}
            </Button>
          </div>

          {(resolved.length > 0 || unresolved.length > 0) && (
            <div className="space-y-2">
              {resolved.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">확인됨 {resolved.length}명</p>
                  <div className="max-h-32 overflow-y-auto rounded-md border divide-y">
                    {resolved.map((r) => (
                      <div key={r.input} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                        <span className="truncate">{r.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {unresolved.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-amber-700">미해결 {unresolved.length}건</p>
                  <div className="max-h-32 overflow-y-auto rounded-md border divide-y">
                    {unresolved.map((u) => (
                      <div key={u.input} className="flex items-start gap-2 px-2 py-1.5 text-sm text-amber-700">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="font-medium">{u.input}</span> — {u.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {summary && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                발급 결과 — {summary.succeeded.length}명 성공 / 총 {summary.grantedTotal}장
                {summary.failed.length > 0 && ` · ${summary.failed.length}명 실패`}
              </p>
              <div className="max-h-40 overflow-y-auto rounded-md border divide-y">
                {summary.succeeded.map((s) => (
                  <div key={s.label} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-600" />
                    <span className="truncate">{s.label}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{s.granted}장</span>
                  </div>
                ))}
                {summary.failed.map((f) => (
                  <div key={f.label} className="flex items-start gap-2 px-2 py-1.5 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="font-medium">{f.label}</span> — {skipReasonLabel(f.reason)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>닫기</Button>
          {summary && summary.failed.length > 0 && (
            <Button
              variant="destructive"
              onClick={() => handleIssue(true)}
              disabled={bulkIssue.isPending}
            >
              {bulkIssue.isPending ? '발급 중...' : '강제 발급'}
            </Button>
          )}
          <Button onClick={() => handleIssue(false)} disabled={!canIssue}>
            {bulkIssue.isPending ? '발급 중...' : '발급'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
