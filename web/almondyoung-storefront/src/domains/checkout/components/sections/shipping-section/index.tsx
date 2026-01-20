"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { HttpTypes, StoreCartAddress } from "@medusajs/types"
import debounce from "lodash/debounce"
import { MapPin } from "lucide-react"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { ShippingAddressModal } from "./shipping-address-modal"
import { ShippingAddressSelector } from "./shipping-address-selector"
import { updateCart } from "@/lib/api/medusa/cart"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ShippingSectionProps {
  shippingAddress: StoreCartAddress | null
  addressName?: string | null
  /** 배송메모 타입: "door" | "security" | "parcel-box" | "direct" | "other" */
  shippingMemoType?: string | null
  /** 기타 선택 시 직접 입력한 메모 */
  shippingMemoCustom?: string | null
}

interface EditAddressState {
  address: HttpTypes.StoreCustomerAddress
  defaultValues: {
    addressName?: string
    name: string
    phone: string
    postalCode: string
    address1: string
    address2: string
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

const isValidAddress = (address: StoreCartAddress | null): boolean => {
  if (!address) return false

  const hasName = !!(address.first_name || address.last_name)
  const hasAddress = !!(
    address.province ||
    address.city ||
    address.address_1 ||
    address.address_2
  )
  const hasPhone = !!address.phone

  return hasName || hasAddress || hasPhone
}

const formatPhoneNumber = (value: string): string => {
  const numbers = value.replace(/\D/g, "")
  if (numbers.length <= 3) return numbers
  if (numbers.length <= 7) return `${numbers.slice(0, 3)}-${numbers.slice(3)}`
  return `${numbers.slice(0, 3)}-${numbers.slice(3, 7)}-${numbers.slice(7, 11)}`
}

const formatAddress = (
  address: StoreCartAddress | null
): {
  name: string
  phone: string
  fullAddress: string
} => {
  if (!address) {
    return { name: "", phone: "", fullAddress: "" }
  }

  const name = [address.first_name, address.last_name].filter(Boolean).join(" ")
  const phone = address.phone ? formatPhoneNumber(address.phone) : ""
  const addressParts = [
    address.province,
    address.city,
    address.address_1,
    address.address_2,
  ].filter(Boolean)
  const fullAddress = addressParts.join(" ")

  return { name, phone, fullAddress }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SHIPPING_MEMO_OPTIONS = [
  { value: "door", label: "문 앞에 놓아주세요" },
  { value: "security", label: "경비실에 맡겨주세요" },
  { value: "parcel-box", label: "택배함에 넣어주세요" },
  { value: "direct", label: "직접 받겠습니다" },
  { value: "other", label: "기타 (직접 입력)" },
] as const

type ShippingMemoValue = (typeof SHIPPING_MEMO_OPTIONS)[number]["value"]

const DEBOUNCE_DELAY = 800

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export const ShippingSection = ({
  shippingAddress,
  addressName,
  shippingMemoType,
  shippingMemoCustom,
}: ShippingSectionProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"create" | "edit">("create")
  const [editAddressState, setEditAddressState] =
    useState<EditAddressState | null>(null)

  const [selectedMemoType, setSelectedMemoType] = useState<
    ShippingMemoValue | ""
  >((shippingMemoType as ShippingMemoValue) || "")
  const [customMemo, setCustomMemo] = useState(shippingMemoCustom || "")
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setSelectedMemoType((shippingMemoType as ShippingMemoValue) || "")
    setCustomMemo(shippingMemoCustom || "")
  }, [shippingMemoType, shippingMemoCustom])

  const isValid = useMemo(
    () => isValidAddress(shippingAddress),
    [shippingAddress]
  )

  const { name, phone, fullAddress } = useMemo(
    () => formatAddress(shippingAddress),
    [shippingAddress]
  )

  const isOtherSelected = selectedMemoType === "other"

  // 배송메모 저장
  const saveShippingMemo = useMemo(
    () =>
      debounce((type: ShippingMemoValue | "", custom: string) => {
        startTransition(async () => {
          try {
            await updateCart({
              metadata: {
                shipping_memo_type: type,
                shipping_memo_custom: type === "other" ? custom : "",
              },
            })
          } catch (error) {
            console.error("배송메모 저장 실패:", error)
          }
        })
      }, DEBOUNCE_DELAY),
    []
  )

  useEffect(() => {
    return () => {
      saveShippingMemo.cancel()
    }
  }, [saveShippingMemo])

  // 새 배송지 추가 핸들러
  const handleAddNewAddress = useCallback(() => {
    setModalMode("create")
    setEditAddressState(null)
    setIsModalOpen(true)
  }, [])

  // 배송지 수정 핸들러
  const handleEditAddress = useCallback(
    (address: HttpTypes.StoreCustomerAddress) => {
      setModalMode("edit")
      setEditAddressState({
        address,
        defaultValues: {
          addressName: address.address_name ?? "",
          name: [address.first_name, address.last_name]
            .filter(Boolean)
            .join(" "),
          phone: address.phone ?? "",
          postalCode: address.postal_code ?? "",
          address1: [address.province, address.city, address.address_1]
            .filter(Boolean)
            .join(" "),
          address2: address.address_2 ?? "",
        },
      })
      setIsModalOpen(true)
    },
    []
  )

  // 모달 닫기 핸들러
  const handleModalOpenChange = useCallback((open: boolean) => {
    setIsModalOpen(open)
    if (!open) {
      setEditAddressState(null)
      setModalMode("create")
    }
  }, [])

  // 배송메모 타입 변경 핸들러
  const handleMemoTypeChange = useCallback(
    (value: string) => {
      const memoType = value as ShippingMemoValue
      setSelectedMemoType(memoType)

      // 기타가 아닌 경우 즉시 저장
      if (memoType !== "other") {
        setCustomMemo("")
        saveShippingMemo(memoType, "")
      }
    },
    [saveShippingMemo]
  )

  // 커스텀 메모 입력 핸들러 (debounced 저장)
  const handleCustomMemoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setCustomMemo(value)
      saveShippingMemo("other", value)
    },
    [saveShippingMemo]
  )

  return (
    <section aria-labelledby="shipping-heading" className="mb-8">
      <h2
        id="shipping-heading"
        className="mb-3 text-base font-bold text-gray-900 md:text-xl"
      >
        배송지
      </h2>
      <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] md:rounded-[10px] md:px-10 md:py-8">
        {isValid ? (
          <>
            <div className="flex justify-between md:w-full">
              <div className="flex-1">
                {(addressName || name) && (
                  <p className="mb-3 flex flex-col gap-2 text-[15px] font-semibold text-gray-900 md:flex-row md:items-center md:text-lg">
                    {addressName ? (
                      <>
                        <span className="font-bold">{addressName}</span>
                        {name ? (
                          <span className="text-sm font-normal text-gray-600">
                            {name}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span>{name}</span>
                    )}
                    <span className="hidden rounded bg-[#e8f6ea] px-2 py-[2px] text-[11px] font-semibold text-[#2ba24c] md:inline">
                      기본 배송지
                    </span>
                  </p>
                )}
                {phone && (
                  <p className="mt-1 text-[13px] text-gray-700 md:text-base">
                    {phone}
                  </p>
                )}
                {fullAddress && (
                  <address className="text-[13px] leading-5 text-gray-700 not-italic md:text-base">
                    {fullAddress}
                  </address>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSelectorOpen(true)}
              >
                변경
              </Button>
            </div>
            {/* 배송메모 섹션 */}
            <div className="mt-4 space-y-3">
              <Select
                value={selectedMemoType}
                onValueChange={handleMemoTypeChange}
              >
                <SelectTrigger
                  className={cn(
                    "h-auto w-full rounded border border-gray-300 bg-white px-3 py-2.5 text-[13px] text-gray-700 md:rounded-[5px] md:px-4 md:py-3.5 md:text-sm",
                    !selectedMemoType && "text-gray-400"
                  )}
                  aria-label="배송메모 선택"
                >
                  <SelectValue placeholder="배송메모를 선택해주세요" />
                </SelectTrigger>
                <SelectContent>
                  {SHIPPING_MEMO_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="cursor-pointer py-2.5 text-[13px] md:text-sm"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* 기타 직접 입력 필드 */}
              <div
                className={cn(
                  "grid transition-all duration-200 ease-in-out",
                  isOtherSelected
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="overflow-hidden">
                  <div className="relative">
                    <Input
                      type="text"
                      value={customMemo}
                      onChange={handleCustomMemoChange}
                      placeholder="배송 시 요청사항을 입력해주세요"
                      maxLength={50}
                      className="h-auto w-full rounded border border-gray-300 px-3 py-2.5 pr-14 text-[13px] text-gray-700 placeholder:text-gray-400 focus:border-gray-400 focus:bg-white md:rounded-[5px] md:px-4 md:py-3.5 md:text-sm"
                      aria-label="배송메모 직접 입력"
                    />
                    <span className="absolute top-1/2 right-3 -translate-y-1/2 text-[11px] text-gray-400 md:text-xs">
                      {customMemo.length}/50
                    </span>
                  </div>
                  {isPending && (
                    <p className="mt-1.5 text-[11px] text-gray-500 md:text-xs">
                      저장 중...
                    </p>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-8 md:py-12">
            <div className="bg-gray-10 mb-4 flex h-12 w-12 items-center justify-center rounded-full md:h-16 md:w-16">
              <MapPin className="text-gray-40 h-6 w-6 md:h-8 md:w-8" />
            </div>
            <h3 className="text-gray-90 mb-2 text-base font-semibold md:text-lg">
              배송지 정보가 없습니다
            </h3>
            <p className="text-gray-60 mb-4 text-center text-sm md:text-base">
              배송지를 등록해주세요.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsSelectorOpen(true)}
              >
                저장된 배송지
              </Button>
              <Button type="button" onClick={handleAddNewAddress}>
                새 배송지 추가
              </Button>
            </div>
          </div>
        )}
      </div>

      <ShippingAddressSelector
        open={isSelectorOpen}
        onOpenChange={setIsSelectorOpen}
        onAddNewAddress={handleAddNewAddress}
        onEditAddress={handleEditAddress}
      />

      <ShippingAddressModal
        open={isModalOpen}
        onOpenChange={handleModalOpenChange}
        mode={modalMode}
        addressId={editAddressState?.address.id}
        defaultValues={editAddressState?.defaultValues}
      />
    </section>
  )
}
