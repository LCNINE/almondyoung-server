'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { PickingSessionDrawer } from '../picking-session-drawer';

export function IndividualPickingTab() {
  const [foId, setFoId] = useState('');
  const [searchedFoId, setSearchedFoId] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const handleSearch = () => {
    const trimmed = foId.trim();
    if (!trimmed) return;
    setSearchedFoId(trimmed);
    setDrawerOpen(true);
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="fo-id-input">주문처리 ID</Label>
          <Input
            id="fo-id-input"
            placeholder="Fulfillment Order ID 입력"
            value={foId}
            onChange={(e) => setFoId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSearch();
            }}
            className="w-80"
          />
        </div>
        <Button onClick={handleSearch} disabled={!foId.trim()}>
          <Search className="mr-2 h-4 w-4" />
          피킹 시작
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        주문처리 ID를 입력하여 개별 피킹 세션을 시작합니다. 바코드 스캐너로 상품을 스캔하여 피킹을 완료합니다.
      </p>

      {searchedFoId && (
        <PickingSessionDrawer
          foId={searchedFoId}
          open={drawerOpen}
          onClose={() => {
            setDrawerOpen(false);
            setSearchedFoId('');
            setFoId('');
          }}
        />
      )}
    </div>
  );
}
