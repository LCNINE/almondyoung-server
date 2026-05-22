'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { QuickActionsEditDialog } from './QuickActionsEditDialog';
import { useQuickActions } from './useQuickActions';

export function QuickActionsCard() {
  const router = useRouter();
  const { visibleActions, pref, savePref, isReady } = useQuickActions();
  const [editOpen, setEditOpen] = useState(false);

  return (
    <Card className="bg-white border border-gray-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-gray-900 text-base">빠른 액션</CardTitle>
            <CardDescription className="text-gray-500 text-xs mt-0.5">
              자주 사용하는 메뉴
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-gray-400 hover:text-gray-600"
            onClick={() => setEditOpen(true)}
            disabled={!isReady}
            aria-label="빠른 액션 편집"
          >
            <Pencil className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {visibleActions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            표시할 빠른 액션이 없어요. 편집에서 추가해 보세요.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-2">
            {visibleActions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.id}
                  variant="ghost"
                  className="flex flex-col items-center gap-2 h-20 rounded-xl hover:bg-gray-50 border border-transparent hover:border-gray-200"
                  onClick={() => router.push(action.path)}
                >
                  <div className={`p-2 rounded-lg ${action.bg}`}>
                    <Icon className={`w-4 h-4 ${action.iconColor}`} />
                  </div>
                  <span className="text-xs text-gray-600 font-normal">{action.label}</span>
                </Button>
              );
            })}
          </div>
        )}
      </CardContent>

      <QuickActionsEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        pref={pref}
        onSave={savePref}
      />
    </Card>
  );
}
