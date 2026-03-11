'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMatching } from '@/lib/services/orders';
import { ProductRegistrationDialog } from '@/features/order/matching/components/table/InventoryMatchingDialog';
import { Button } from '@/components/common';
import { Loader2, X } from 'lucide-react';

function InventoryMatchingDialogContent() {
    const searchParams = useSearchParams();
    const matchingId = searchParams.get('matchingId');

    const { data: matching, isLoading, error } = useMatching(matchingId || '');

    if (isLoading) {
        return (
            <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600">매칭 정보를 불러오는 중...</p>
            </div>
        );
    }

    if (error || !matching) {
        return (
            <div className="text-center">
                <X className="w-12 h-12 mx-auto text-red-400 mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">매칭 정보를 찾을 수 없습니다</h2>
                <p className="text-gray-600 mb-6">잘못된 매칭 ID이거나 매칭 정보가 존재하지 않습니다.</p>
                <Button
                    onClick={() => window.close()}
                    variant="outline"
                >
                    창 닫기
                </Button>
            </div>
        );
    }

    return (
        <div className="w-full max-w-6xl">
            <ProductRegistrationDialog
                isOpen={true}
                onClose={() => window.close()}
                matching={matching}
            />
        </div>
    );
}

export default function InventoryMatchingDialogPage() {
    return (
        <Suspense>
            <InventoryMatchingDialogContent />
        </Suspense>
    );
}
