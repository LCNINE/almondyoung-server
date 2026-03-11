"use client"

import { Button } from "@/components/ui/button"

interface AddressDisplayProps {
  addressName?: string | null
  name: string
  phone: string
  postalCode: string
  address1: string
  address2: string
  fullAddress: string
  onChangeClick: () => void
}

/**
 * 배송지 정보를 표시하는 컴포넌트
 */
export function AddressDisplay({
  addressName,
  name,
  phone,
  postalCode,
  address1,
  address2,
  fullAddress,
  onChangeClick,
}: AddressDisplayProps) {
  const hasNameInfo = addressName || name
  const hasAddressInfo = postalCode || address1 || address2 || fullAddress

  return (
    <div className="flex justify-between lg:w-full">
      <div className="flex-1">
        {hasNameInfo && (
          <p className="mb-3 flex flex-col gap-2 text-[15px] font-semibold text-gray-900 lg:flex-row lg:items-center lg:text-lg">
            <AddressNameDisplay addressName={addressName} name={name} />
            <span className="hidden rounded bg-[#e8f6ea] px-2 py-[2px] text-[11px] font-semibold text-[#2ba24c] lg:inline">
              기본 배송지
            </span>
          </p>
        )}

        {(phone || hasAddressInfo) && (
          <dl className="space-y-1.5 text-[13px] text-gray-700 lg:text-base">
            <AddressRow label="연락처" value={phone} />
            <AddressRow label="우편번호" value={postalCode} />
            <AddressRow label="기본주소" value={address1 || fullAddress} />
            <AddressRow label="상세주소" value={address2} />
          </dl>
        )}
      </div>

      <Button type="button" variant="outline" onClick={onChangeClick}>
        변경
      </Button>
    </div>
  )
}

function AddressRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2">
      <dt className="min-w-14 text-gray-500">{label}</dt>
      <dd className="text-gray-700">{value || "-"}</dd>
    </div>
  )
}

/**
 * 주소 이름/수신자명 표시
 */
function AddressNameDisplay({
  addressName,
  name,
}: {
  addressName?: string | null
  name: string
}) {
  if (addressName) {
    return (
      <>
        <span className="font-bold">{addressName}</span>
        {name && (
          <span className="text-sm font-normal text-gray-600">{name}</span>
        )}
      </>
    )
  }

  return <span>{name}</span>
}
