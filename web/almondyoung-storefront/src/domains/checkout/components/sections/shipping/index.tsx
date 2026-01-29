"use client"

import { HttpTypes } from "@medusajs/types"
import { useCallback, useMemo, useState } from "react"
import { ShippingAddressModal } from "./address-form-modal"
import { ShippingAddressSelectorModal } from "./address-selector-modal"
import {
  AddressDisplay,
  AddressLoadingState,
  EmptyAddressState,
  ShippingMemoSelector,
} from "./components"
import { useAutoFillShipping } from "./hooks/use-auto-fill-shipping"
import type { EditAddressState, ShippingSectionProps } from "./types"
import { formatAddress, isValidAddress } from "./utils"

export const ShippingSection = ({
  shippingAddress,
  addressName,
  shippingMemo,
  onShippingMemoChange,
}: ShippingSectionProps) => {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"create" | "edit">("create")
  const [editAddressState, setEditAddressState] =
    useState<EditAddressState | null>(null)

  // 배송지 자동 채움
  // todo: 메두사 백엔드에서 하도록 변경해야됌 그리고, 배송메모도 마찬가지임 (메두사 카트에 담을때 훅(스텝)걸어서)
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
      onShippingMemoChange({
        type: value,
        custom: value === "other" ? shippingMemo.custom : "",
      })
    },
    [onShippingMemoChange, shippingMemo.custom]
  )

  const handleCustomMemoChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onShippingMemoChange({
        type: "other",
        custom: e.target.value,
      })
    },
    [onShippingMemoChange]
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
          selectedMemoType={shippingMemo.type}
          customMemo={shippingMemo.custom}
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
        className="mb-3 text-base font-bold text-gray-900 lg:text-xl"
      >
        배송지
      </h2>
      <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] lg:rounded-[10px] lg:px-10 lg:py-8">
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
