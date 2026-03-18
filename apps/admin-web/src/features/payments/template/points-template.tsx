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

export default function PointsTemplate() {
  const [userId, setUserId] = useState('');
  const [searchUserId, setSearchUserId] = useState('');
  const [earnOpen, setEarnOpen] = useState(false);

  const { data: balance } = usePointsBalance(searchUserId);

  const handleSearch = () => {
    if (!userId.trim()) return;
    setSearchUserId(userId.trim());
  };

  return (
    <div className="space-y-4">
      <Container className="divide-y-0">
        <Header title="포인트 관리" />
      </Container>

      <Container>
        <div className="p-4 flex items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="points-user-id">사용자 ID</Label>
            <Input
              id="points-user-id"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="사용자 ID 입력"
              className="w-64"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>
          <Button onClick={handleSearch}>조회</Button>
          {searchUserId && (
            <Button variant="outline" onClick={() => setEarnOpen(true)}>
              포인트 적립
            </Button>
          )}
        </div>
      </Container>

      {searchUserId && (
        <>
          <PointsBalanceCards balance={balance} />
          <Container className="divide-y-0">
            <Header title="포인트 이벤트" />
            <PointsEventTable userId={searchUserId} />
          </Container>
        </>
      )}

      {searchUserId && (
        <PointsEarnDialog
          userId={searchUserId}
          open={earnOpen}
          onOpenChange={setEarnOpen}
        />
      )}
    </div>
  );
}
