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
import { AlertCircle } from 'lucide-react';

export default function PointsTemplate() {
  const [userId, setUserId] = useState('');
  const [searchUserId, setSearchUserId] = useState('');
  const [earnOpen, setEarnOpen] = useState(false);
  const [deductOpen, setDeductOpen] = useState(false);

  const { data: balance, isError, isLoading } = usePointsBalance(searchUserId);

  const handleSearch = () => {
    const trimmed = userId.trim();
    if (!trimmed) return;
    setSearchUserId(trimmed);
  };

  return (
    <div className="space-y-4">
      <Container className="divide-y-0">
        <Header title="포인트 관리" />
      </Container>

      <Container>
        <div className="p-4 flex items-end gap-3 flex-wrap">
          <div className="space-y-2">
            <Label htmlFor="points-user-id">사용자 ID</Label>
            <Input
              id="points-user-id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="사용자 ID 입력"
              className="w-72"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch} disabled={!userId.trim()}>조회</Button>

          {searchUserId && balance && (
            <>
              <Button variant="outline" onClick={() => setEarnOpen(true)}>
                포인트 지급
              </Button>
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setDeductOpen(true)}
              >
                포인트 차감
              </Button>
            </>
          )}
        </div>
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
                  포인트 정보를 불러오지 못했습니다. 사용자 ID를 확인하거나 잠시 후 다시 시도해주세요.
                </span>
              </div>
            </Container>
          )}

          {!isError && !isLoading && (
            <PointsBalanceCards balance={balance} />
          )}

          <Container className="divide-y-0">
            <Header title="포인트 이벤트" />
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
