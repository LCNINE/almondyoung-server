"use client"

import { Button } from "@/components/ui/button"

interface AddressDisplayProps {
  addressName?: string | null
  name: string
  phone: string
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
  fullAddress,
  onChangeClick,
}: AddressDisplayProps) {
  const hasNameInfo = addressName || name

  return (
    <div className="flex justify-between md:w-full">
      <div className="flex-1">
        {hasNameInfo && (
          <p className="mb-3 flex flex-col gap-2 text-[15px] font-semibold text-gray-900 md:flex-row md:items-center md:text-lg">
            <AddressNameDisplay addressName={addressName} name={name} />
            <span className="hidden rounded bg-[#e8f6ea] px-2 py-[2px] text-[11px] font-semibold text-[#2ba24c] md:inline">
              기본 배송지
            </span>
          </p>
        )}

        {phone && (
          <p className="mt-1 text-[13px] text-gray-700 md:text-base">{phone}</p>
        )}

        {fullAddress && (
          <address className="text-[13px] leading-5 text-gray-700 not-italic md:text-base">
            {fullAddress}
          </address>
        )}
      </div>

      <Button type="button" variant="outline" onClick={onChangeClick}>
        변경
      </Button>
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
