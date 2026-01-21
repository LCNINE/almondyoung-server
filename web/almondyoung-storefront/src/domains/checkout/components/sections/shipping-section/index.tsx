"use client"

import { updateCart } from "@/lib/api/medusa/cart"
import { HttpTypes } from "@medusajs/types"
import debounce from "lodash/debounce"
import { useCallback, useEffect, useMemo, useState, useTransition } from "react"
import { ShippingAddressModal } from "./address-form-modal"
import { ShippingAddressSelectorModal } from "./address-selector-modal"
import {
  AddressDisplay,
  AddressLoadingState,
  EmptyAddressState,
  ShippingMemoSelector,
} from "./components"
import { DEBOUNCE_DELAY, type ShippingMemoValue } from "./constants"
import { useAutoFillShipping } from "./hooks/use-auto-fill-shipping"
import type { EditAddressState, ShippingSectionProps } from "./types"
import { formatAddress, isValidAddress } from "./utils"

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

  // 자동 배송지 채움
  const { isAutoFilling } = useAutoFillShipping({ shippingAddress })

  // 배송지 정보 파싱
  const isValid = useMemo(
    () => isValidAddress(shippingAddress),
    [shippingAddress]
  )
  const { name, phone, fullAddress } = useMemo(
    () => formatAddress(shippingAddress),
    [shippingAddress]
  )

  // 메모 타입 동기화
  useEffect(() => {
    setSelectedMemoType((shippingMemoType as ShippingMemoValue) || "")
    setCustomMemo(shippingMemoCustom || "")
  }, [shippingMemoType, shippingMemoCustom])

  // 디바운스된 메모 저장
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
    return () => saveShippingMemo.cancel()
  }, [saveShippingMemo])

  const handleAddNewAddress = useCallback(() => {
    setModalMode("create")
    setEditAddressState(null)
    setIsModalOpen(true)
  }, [])

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
          isDefaultShipping: address.is_default_shipping ?? false,
          metadata: address.metadata ?? {},
        },
      })
      setIsModalOpen(true)
    },
    []
  )

  const handleModalOpenChange = useCallback((open: boolean) => {
    setIsModalOpen(open)
    if (!open) {
      setEditAddressState(null)
      setModalMode("create")
    }
  }, [])

  const handleMemoTypeChange = useCallback(
    (value: string) => {
      const memoType = value as ShippingMemoValue
      setSelectedMemoType(memoType)

      if (memoType !== "other") {
        setCustomMemo("")
        saveShippingMemo(memoType, "")
      }
    },
    [saveShippingMemo]
  )

  const handleCustomMemoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value
      setCustomMemo(value)
      saveShippingMemo("other", value)
    },
    [saveShippingMemo]
  )

  const renderContent = () => {
    if (isAutoFilling) {
      return <AddressLoadingState />
    }

    if (!isValid) {
      return (
        <EmptyAddressState
          onSelectSaved={() => setIsSelectorOpen(true)}
          onAddNew={handleAddNewAddress}
        />
      )
    }

    return (
      <>
        <AddressDisplay
          addressName={addressName}
          name={name}
          phone={phone}
          fullAddress={fullAddress}
          onChangeClick={() => setIsSelectorOpen(true)}
        />
        <ShippingMemoSelector
          selectedMemoType={selectedMemoType}
          customMemo={customMemo}
          isPending={isPending}
          onMemoTypeChange={handleMemoTypeChange}
          onCustomMemoChange={handleCustomMemoChange}
        />
      </>
    )
  }

  return (
    <section aria-labelledby="shipping-heading" className="mb-8">
      <h2
        id="shipping-heading"
        className="mb-3 text-base font-bold text-gray-900 md:text-xl"
      >
        배송지
      </h2>
      <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] md:rounded-[10px] md:px-10 md:py-8">
        {renderContent()}
      </div>

      <ShippingAddressSelectorModal
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
        onSuccess={
          modalMode === "create" ? () => setIsSelectorOpen(true) : undefined
        }
      />
    </section>
  )
}
