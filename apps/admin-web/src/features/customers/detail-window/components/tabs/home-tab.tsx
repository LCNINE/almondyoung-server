'use client';

import { useState } from 'react';
import { Star, User } from 'lucide-react';
import { OrderDetailDialog } from './orders-tab';
import { Button } from '@/components/ui/button';
import { useCustomerById } from '@/lib/services/customers';
import {
  useMedusaCustomerByEmail,
  useMedusaOrdersByCustomerId,
} from '@/lib/services/medusa-customers';
import { formatDate } from '@/lib/utils/date';
import { formatPhoneNumber } from '@/lib/utils/phone';
import { BlacklistSetting } from '../blacklist-setting';
import {
  formatOrderAmount,
  paymentStatusLabel,
  fulfillmentStatusLabel,
} from '../../lib/order-labels';

function membershipLabel(roles: string[] | undefined): string {
  if (!roles?.length) return '일반 회원';
  if (roles.includes('membership')) return '멤버십 회원';
  return '일반 회원';
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-800">
        <User className="size-4 text-indigo-500" />
        {title}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-24 shrink-0 text-gray-500">{label}</span>
      <span className="text-gray-900">{value ?? '-'}</span>
    </div>
  );
}

export function HomeTab({ customerId }: { customerId: string }) {
  const { data: customer, isLoading } = useCustomerById(customerId);
  const profile = customer?.profile;
  // 주문정보 행 클릭 시 주문내역 탭과 동일한 상세 다이얼로그(현금영수증 포함)를 연다.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // user-service 회원 ↔ Medusa 고객은 이메일로 매칭한다.
  const email = customer?.email ?? '';
  const { data: medusaCustomerRes, isLoading: isMedusaCustomerLoading } =
    useMedusaCustomerByEmail(email);
  const medusaCustomerId = medusaCustomerRes?.customers?.[0]?.id;
  const {
    data: ordersRes,
    isLoading: isOrdersLoading,
    isError: isOrdersError,
  } = useMedusaOrdersByCustomerId(medusaCustomerId);
  const orders = ordersRes?.orders ?? [];
  const orderCount = ordersRes?.count ?? orders.length;
  const isOrderSectionLoading =
    !!email && (isMedusaCustomerLoading || isOrdersLoading);
  // 연동 고객을 못 찾았거나(이메일 미일치) 주문 조회가 실패한 경우
  const hasOrderError = !!email && !isOrderSectionLoading && isOrdersError;

  if (isLoading) {
    return <div className="text-sm text-gray-400">불러오는 중…</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 우측 상단 액션바 */}
      <div className="flex justify-end gap-2">
        <BlacklistSetting userId={customerId} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled
          title="준비 중"
        >
          <Star className="mr-1 h-4 w-4" />
          단골리스트 설정
        </Button>
      </div>

      <div className="grid grid-cols-[1fr_280px] gap-4">
        {/* 기본정보 */}
        <Card title="기본정보">
          <div className="grid grid-cols-2 gap-x-8">
            <div>
              <Field label="아이디" value={customer?.loginId ?? null} />
              <Field label="이름" value={customer?.username ?? null} />
              <Field
                label="휴대폰"
                value={
                  profile?.phoneNumber
                    ? formatPhoneNumber(profile.phoneNumber)
                    : null
                }
              />
              <Field label="Email" value={customer?.email ?? null} />
              <Field label="주소" value={profile?.address ?? null} />
            </div>
            <div>
              <Field
                label="회원등급"
                value={membershipLabel(customer?.roles)}
              />
              <Field
                label="이메일 인증"
                value={customer?.isEmailVerified ? '인증완료' : '미인증'}
              />
              <Field
                label="가입일"
                value={formatDate(customer?.createdAt)}
              />
              <Field
                label="최근 활동일"
                value={formatDate(customer?.lastActivityAt)}
              />
            </div>
          </div>
        </Card>

        {/* 메모 (단계 2에서 연동) */}
        <Card title="메모">
          <div className="text-sm text-gray-400">내용 없음</div>
        </Card>
      </div>

      {/* 주문정보 */}
      <section className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800">
          주문정보
          {!isOrderSectionLoading && (
            <span className="text-xs font-normal text-gray-500">
              총 {orderCount.toLocaleString()}건
            </span>
          )}
        </div>

        {isOrderSectionLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">
            불러오는 중…
          </div>
        ) : hasOrderError ? (
          <div className="py-8 text-center text-sm text-red-400">
            주문 정보를 불러오지 못했습니다.
          </div>
        ) : orders.length === 0 ? (
          <div className="py-8 text-center text-sm text-gray-400">
            주문 내역이 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                  <th className="py-2 pr-3 font-medium">주문번호</th>
                  <th className="py-2 pr-3 font-medium">주문일</th>
                  <th className="py-2 pr-3 text-right font-medium">결제금액</th>
                  <th className="py-2 pr-3 font-medium">결제상태</th>
                  <th className="py-2 font-medium">배송상태</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    onClick={() => setSelectedOrderId(order.id)}
                    className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="py-2 pr-3 text-gray-900">
                      #{order.display_id}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">
                      {formatDate(order.created_at)}
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-900">
                      {formatOrderAmount(order)}
                    </td>
                    <td className="py-2 pr-3 text-gray-600">
                      {paymentStatusLabel(order.payment_status)}
                    </td>
                    <td className="py-2 text-gray-600">
                      {fulfillmentStatusLabel(order.fulfillment_status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <OrderDetailDialog
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
      />
    </div>
  );
}
