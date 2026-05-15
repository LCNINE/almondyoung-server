'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePointsBalance } from '@/lib/services/wallet';
import { PointsBalanceCards } from '../components/points-balance-cards';
import { PointsEventTable } from '../components/points-event-table';
import { PointsEarnDialog } from '../components/points-earn-dialog';
import { PointsDeductDialog } from '../components/points-deduct-dialog';
import { userApi } from '@/lib/api/domains/users';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

export default function PointsTemplate() {
  const [query, setQuery] = useState('');
  const [searchUserId, setSearchUserId] = useState('');
  const [resolvedUser, setResolvedUser] = useState<{ loginId: string; username: string } | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [earnOpen, setEarnOpen] = useState(false);
  const [deductOpen, setDeductOpen] = useState(false);

  const { data: balance, isError, isLoading } = usePointsBalance(searchUserId);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setLookupError('');
    setResolvedUser(null);
    setSearchUserId('');
    setIsLookingUp(true);
    try {
      const res = await userApi.getAdminUsers({ q: trimmed, limit: 5 });
      if (res.data.length === 0) {
        setLookupError('사용자를 찾을 수 없습니다.');
      } else if (res.data.length > 1) {
        setLookupError(`${res.data.length}명이 검색됩니다. 더 구체적으로 입력해주세요.`);
      } else {
        const user = res.data[0];
        setResolvedUser({ loginId: user.loginId, username: user.username });
        setSearchUserId(user.id);
      }
    } catch {
      setLookupError('사용자 조회 중 오류가 발생했습니다.');
    } finally {
      setIsLookingUp(false);
    }
  };

  return (
    <div className="space-y-4">
      <Container className="divide-y-0">
        <Header title="적립금 관리" />
      </Container>

      <Container>
        <div className="p-4 flex items-end gap-3 flex-wrap">
          <div className="space-y-2">
            <Label htmlFor="points-user-id">사용자 검색 (loginId / 이메일)</Label>
            <Input
              id="points-user-id"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="loginId 또는 이메일 입력"
              className="w-72"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch} disabled={!query.trim() || isLookingUp}>
            {isLookingUp ? '조회 중...' : '조회'}
          </Button>

          {searchUserId && balance && (
            <>
              <Button variant="outline" onClick={() => setEarnOpen(true)}>
                적립금 지급
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setDeductOpen(true)}
              >
                적립금 차감
              </Button>
            </>
          )}
        </div>

        {lookupError && (
          <div className="px-4 pb-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{lookupError}</span>
          </div>
        )}

        {resolvedUser && (
          <div className="px-4 pb-4 flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>
              {resolvedUser.loginId}
              {resolvedUser.username && ` (${resolvedUser.username})`}
            </span>
          </div>
        )}
      </Container>

      {searchUserId && (
        <>
          {isLoading && (
            <Container>
              <div className="p-6 text-sm text-muted-foreground">잔액 조회 중...</div>
            </Container>
          )}

          {isError && !isLoading && (
            <Container>
              <div className="p-6 flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>
                  적립금 정보를 불러오지 못했습니다. 사용자 정보를 확인하거나 잠시 후 다시 시도해주세요.
                </span>
              </div>
            </Container>
          )}

          {!isError && !isLoading && (
            <PointsBalanceCards balance={balance} />
          )}

          <Container className="divide-y-0">
            <Header title="적립금 내역" />
            <PointsEventTable userId={searchUserId} />
          </Container>
        </>
      )}

      {searchUserId && balance && (
        <>
          <PointsEarnDialog
            userId={searchUserId}
            open={earnOpen}
            onOpenChange={setEarnOpen}
          />
          <PointsDeductDialog
            userId={searchUserId}
            availableBalance={balance.available}
            open={deductOpen}
            onOpenChange={setDeductOpen}
          />
        </>
      )}
    </div>
  );
}
