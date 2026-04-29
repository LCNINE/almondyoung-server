'use client';

import { useState } from 'react';
import { Plus, Pencil, Ban, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Container } from '@/components/admin-ui-experimental/common/container/container';
import { Header } from '@/components/admin-ui-experimental/common/header/header';
import { AdminTier, AdminPlan, AdminTierWithPlans } from '@/lib/api/domains/membership';
import { useTiersWithPlans, useActivatePlan } from '@/lib/services/membership';
import { TierFormDialog } from '../components/tier-form-dialog';
import { PlanFormDialog } from '../components/plan-form-dialog';
import { DeactivatePlanDialog } from '../components/deactivate-plan-dialog';

function getPlanLabel(durationDays: number): string {
  if (durationDays >= 365) return '연간';
  if (durationDays >= 28) return '월간';
  return `${durationDays}일`;
}

type DialogState =
  | { type: 'createTier' }
  | { type: 'editTier'; tier: AdminTier }
  | { type: 'createPlan'; tier: AdminTier }
  | { type: 'editPlan'; tier: AdminTier; plan: AdminPlan }
  | { type: 'deactivatePlan'; plan: AdminPlan }
  | null;

function TierCard({
  item,
  onAction,
  onActivatePlan,
  isActivating,
}: {
  item: AdminTierWithPlans;
  onAction: (d: DialogState) => void;
  onActivatePlan: (planId: string) => void;
  isActivating: boolean;
}) {
  const { tier, plans } = item;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{tier.code}</span>
          <Badge variant="outline">우선순위 {tier.priorityLevel}</Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => onAction({ type: 'editTier', tier })}>
            <Pencil className="h-3 w-3" />
            티어 수정
          </Button>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => onAction({ type: 'createPlan', tier })}>
            <Plus className="h-3 w-3" />
            플랜 추가
          </Button>
        </div>
      </div>

      {plans.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">등록된 플랜이 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>구분</TableHead>
              <TableHead>기간</TableHead>
              <TableHead>가격</TableHead>
              <TableHead>무료체험</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>등록일</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((plan) => (
              <TableRow key={plan.id} className={plan.isActive ? '' : 'opacity-50'}>
                <TableCell className="font-medium">{getPlanLabel(plan.durationDays)}</TableCell>
                <TableCell>{plan.durationDays}일</TableCell>
                <TableCell>{plan.price.toLocaleString()}원</TableCell>
                <TableCell>{plan.trialDays ? `${plan.trialDays}일` : '-'}</TableCell>
                <TableCell>
                  <Badge variant={plan.isActive ? 'default' : 'secondary'}>
                    {plan.isActive ? '활성' : '비활성'}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(plan.createdAt).toLocaleDateString('ko-KR')}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-xs"
                      onClick={() => onAction({ type: 'editPlan', tier, plan })}
                    >
                      수정
                    </Button>
                    {plan.isActive ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                        onClick={() => onAction({ type: 'deactivatePlan', plan })}
                      >
                        <Ban className="h-3 w-3" />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-blue-600 hover:text-blue-700"
                        disabled={isActivating}
                        onClick={() => onActivatePlan(plan.id)}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function MembershipPlansTemplate() {
  const { data: tiers, isLoading } = useTiersWithPlans();
  const [dialog, setDialog] = useState<DialogState>(null);
  const activatePlanMutation = useActivatePlan();

  return (
    <Container className="divide-y-0">
      <Header
        title="멤버십 플랜"
        subtitle="멤버십 티어와 플랜을 관리합니다."
      />

      <div className="mb-4 flex justify-end">
        <Button onClick={() => setDialog({ type: 'createTier' })} className="gap-1">
          <Plus className="h-4 w-4" />
          티어 추가
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <Skeleton key={i} className="h-40 w-full rounded-lg" />)}
        </div>
      ) : tiers?.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">등록된 티어가 없습니다.</p>
      ) : (
        <div className="space-y-4">
          {tiers?.map((item) => (
            <TierCard
              key={item.tier.id}
              item={item}
              onAction={setDialog}
              onActivatePlan={(planId) => activatePlanMutation.mutate(planId)}
              isActivating={activatePlanMutation.isPending}
            />
          ))}
        </div>
      )}

      <TierFormDialog
        open={dialog?.type === 'createTier' || dialog?.type === 'editTier'}
        onClose={() => setDialog(null)}
        tier={dialog?.type === 'editTier' ? dialog.tier : undefined}
      />
      <PlanFormDialog
        open={dialog?.type === 'createPlan' || dialog?.type === 'editPlan'}
        onClose={() => setDialog(null)}
        tier={(dialog?.type === 'createPlan' || dialog?.type === 'editPlan') ? dialog.tier : ({ id: '', code: '', priorityLevel: 0, createdAt: '', updatedAt: '' })}
        plan={dialog?.type === 'editPlan' ? dialog.plan : undefined}
      />
      <DeactivatePlanDialog
        open={dialog?.type === 'deactivatePlan'}
        onClose={() => setDialog(null)}
        plan={dialog?.type === 'deactivatePlan' ? dialog.plan : null}
      />
    </Container>
  );
}
