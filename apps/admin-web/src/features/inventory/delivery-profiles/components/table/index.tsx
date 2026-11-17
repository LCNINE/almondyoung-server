'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Can } from '@/components/auth/can';
import {
  useCreateDeliveryProfile,
  useDeleteDeliveryProfile,
  useDeliveryProfiles,
  useHolders,
  useUpdateDeliveryProfile,
} from '@/lib/services/inventory';
import type {
  DeliveryProfileDto,
  FulfillmentMode,
} from '@/lib/types/dto/inventory';
import { FULFILLMENT_MODE_LABELS } from '../../lib/labels';
import { ProfileDialog, type ProfileEditTarget } from '../profile-dialog';

type ModeFilter = 'all' | FulfillmentMode;

const FILTERS: Array<{ value: ModeFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'in_house', label: FULFILLMENT_MODE_LABELS.in_house },
  { value: '3pl', label: FULFILLMENT_MODE_LABELS['3pl'] },
];

function returnLabel(p: DeliveryProfileDto): string {
  const r = p.returnAddress;
  const o = p.originAddress;
  if (
    r.postalCode === o.postalCode &&
    r.roadAddress === o.roadAddress &&
    r.detailAddress === o.detailAddress
  ) {
    return '출고지와 같음';
  }

  return r.roadAddress || '-';
}

export function DeliveryProfilesTable() {
  const { data: profiles = [], isLoading } = useDeliveryProfiles();
  // ponytail: 화주 첫 100개만 이름을 붙인다(서버 상한). 넘으면 목록 응답에 화주 이름을 싣는다
  const { data: holdersResponse } = useHolders({ limit: 100 });
  const remove = useDeleteDeliveryProfile();
  const [editing, setEditing] = useState<ProfileEditTarget | null>(null);
  const [deleting, setDeleting] = useState<DeliveryProfileDto | null>(null);
  const [filter, setFilter] = useState<ModeFilter>('all');
  const [search, setSearch] = useState('');

  const holderNames = useMemo(
    () => new Map((holdersResponse?.data ?? []).map((h) => [h.id, h.name])),
    [holdersResponse]
  );

  const holderName = (p: DeliveryProfileDto) =>
    p.holderId ? (holderNames.get(p.holderId) ?? '-') : '자사';

  const keyword = search.trim().toLowerCase();
  const visible = profiles.filter((p) => {
    if (filter !== 'all' && !p.supportedFulfillmentModes.includes(filter))
      return false;
    if (!keyword) return true;

    return [p.name, holderName(p), p.sender.name].some((v) =>
      v.toLowerCase().includes(keyword)
    );
  });

  const handleDelete = async () => {
    if (!deleting) return;

    try {
      await remove.mutateAsync(deleting.id);
      toast.success('배송 프로필을 지웠어요.');
      setDeleting(null);
    } catch (e: unknown) {
      const message =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? '지우지 못했어요.'; // API error shape from mutation libraries like TanStack Query
      toast.error(message);
    }
  };

  const deletingSkus = deleting?.skuCount ?? 0;

  return (
    <div className="space-y-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="이름, 업체, 보내는 분으로 찾기"
          aria-label="프로필 검색"
          className="max-w-xs"
        />
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
        <div className="ml-auto">
          <Can run={useCreateDeliveryProfile}>
            <Button size="sm" onClick={() => setEditing({ mode: 'new' })}>
              프로필 추가
            </Button>
          </Can>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>업체(화주)</TableHead>
              <TableHead>출고 방식</TableHead>
              <TableHead>보내는 분</TableHead>
              <TableHead>반품지</TableHead>
              <TableHead>택배 계약</TableHead>
              <TableHead className="text-right">쓰는 SKU</TableHead>
              <TableHead className="text-right">작업</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8}>불러오는 중...</TableCell>
              </TableRow>
            )}
            {!isLoading && visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  {profiles.length === 0
                    ? '등록된 배송 프로필이 없어요. 사입·위탁 SKU 를 만들려면 프로필이 있어야 해요.'
                    : '조건에 맞는 프로필이 없어요.'}
                </TableCell>
              </TableRow>
            )}
            {visible.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>{holderName(p)}</TableCell>
                <TableCell>
                  {p.supportedFulfillmentModes
                    .map((m) => FULFILLMENT_MODE_LABELS[m] ?? m)
                    .join(', ')}
                </TableCell>
                <TableCell>
                  {p.sender.name ? (
                    <div className="flex flex-col">
                      <span>{p.sender.name}</span>
                      <span className="text-muted-foreground text-xs">
                        {p.sender.phone}
                      </span>
                    </div>
                  ) : (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                      입력 필요
                    </span>
                  )}
                </TableCell>
                <TableCell>{returnLabel(p)}</TableCell>
                <TableCell>{p.carrierAccountRef || '-'}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {(p.skuCount ?? 0).toLocaleString('ko-KR')}
                </TableCell>
                <TableCell className="space-x-1 text-right whitespace-nowrap">
                  <Can run={useUpdateDeliveryProfile}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing({ mode: 'edit', profile: p })}
                    >
                      수정
                    </Button>
                  </Can>
                  <Can run={useCreateDeliveryProfile}>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing({ mode: 'copy', profile: p })}
                    >
                      복제
                    </Button>
                  </Can>
                  <Can run={useDeleteDeliveryProfile}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-700"
                      onClick={() => setDeleting(p)}
                    >
                      삭제
                    </Button>
                  </Can>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-sm">
        테넌트마다 따로 관리돼요. 다른 회사가 쓰면 그 회사의 프로필만 보여요.
      </p>

      <ProfileDialog
        target={editing}
        onOpenChange={(open) => !open && setEditing(null)}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deletingSkus > 0
                ? '지금은 지울 수 없어요'
                : `${deleting?.name ?? ''} 프로필을 지울까요?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletingSkus > 0
                ? `SKU ${deletingSkus.toLocaleString('ko-KR')}개가 이 프로필을 쓰고 있어요. 그 SKU 를 다른 프로필로 옮긴 뒤 지워 주세요.`
                : '쓰는 SKU 가 없어요. 이 프로필로 나간 출고 상자가 있으면 지울 수 없어요.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {deletingSkus > 0 ? '확인' : '취소'}
            </AlertDialogCancel>
            {deletingSkus === 0 && (
              <AlertDialogAction
                className="bg-red-700 hover:bg-red-800"
                disabled={remove.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  void handleDelete();
                }}
              >
                삭제
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
