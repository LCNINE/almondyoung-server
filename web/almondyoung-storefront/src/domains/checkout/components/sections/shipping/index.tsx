"use client"

import { HttpTypes } from "@medusajs/types"
import { useCallback, useMemo, useState } from "react"
import { ShippingAddressModal } from "../../../../../components/address"
import { ShippingAddressSelectorModal } from "./address-selector-modal"
import {
  AddressDisplay,
  EmptyAddressState,
  ShippingMemoSelector,
} from "./components"
import type { EditAddressState, ShippingSectionProps } from "./types"
import { formatAddress, isValidAddress } from "./utils"

export const ShippingSection = ({
  cartId,
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

  // 배송지 정보 파싱
  const isValid = useMemo(
    () => isValidAddress(shippingAddress),
    [shippingAddress]
  )
  const { name, phone, postalCode, address1, address2, fullAddress } = useMemo(
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
          address1: address.address_1 ?? "",
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

  const renderContent = () => {
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
          postalCode={postalCode}
          address1={address1}
          address2={address2}
          fullAddress={fullAddress}
          onChangeClick={() => setIsSelectorOpen(true)}
        />
        <ShippingMemoSelector
          shippingMemo={shippingMemo}
          onShippingMemoChange={onShippingMemoChange}
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
        cartId={cartId}
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
