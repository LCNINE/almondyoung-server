'use client';

import { useState } from 'react';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChannelListingsTable } from '../components/channel-listings-table';
import { ChannelListingFormDialog } from '../components/channel-listing-form-dialog';

export default function ChannelListingsTemplate() {
  const [variantId, setVariantId] = useState('');
  const [searchedVariantId, setSearchedVariantId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const handleSearch = () => {
    setSearchedVariantId(variantId.trim());
  };

  return (
    <Container className="divide-y-0">
      <Header
        title="채널 노출 관리"
        subtitle="Variant와 판매 채널 간 매핑을 관리합니다. GET /lookup은 Channel Adapter 전용 경로입니다."
      />

      <div className="px-6 py-4 space-y-3">
        <div className="flex gap-2 items-end">
          <div className="space-y-1 flex-1 max-w-md">
            <Label>Variant ID</Label>
            <Input
              placeholder="Variant UUID로 검색"
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
            />
          </div>
          <Button onClick={handleSearch}>조회</Button>
          {searchedVariantId && (
            <Button onClick={() => setCreateOpen(true)} variant="outline">
              리스팅 등록
            </Button>
          )}
        </div>

        {searchedVariantId && (
          <ChannelListingsTable variantId={searchedVariantId} />
        )}

        {!searchedVariantId && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Variant ID를 입력하고 조회하세요.
          </p>
        )}
      </div>

      {searchedVariantId && (
        <ChannelListingFormDialog
          variantId={searchedVariantId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      )}
    </Container>
  );
}
