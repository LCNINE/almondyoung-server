"use client"

import { HttpTypes } from "@medusajs/types"
import { useTranslations } from "next-intl"
import { useCallback, useMemo, useState } from "react"
import { ShippingAddressModal } from "../../../../../components/address"
import { ShippingAddressSelectorModal } from "./address-selector-modal"
import { SectionCard } from "../../shared/section-card"
import {
  AddressDisplay,
  EmptyAddressState,
  ShippingMemoDialog,
} from "./components"
import type { EditAddressState, ShippingSectionProps } from "./types"
import { formatAddress, formatShippingMemo, isValidAddress } from "./utils"

export const ShippingSection = ({
  cartId,
  shippingAddress,
  addressName,
  shippingMemo,
  onShippingMemoChange,
}: ShippingSectionProps) => {
  const t = useTranslations("checkout.shipping")
  const tMemo = useTranslations("checkout.shipping.memo")
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [isMemoOpen, setIsMemoOpen] = useState(false)
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
          // ko 는 단일 name, en/ja 는 분리 필드를 사용한다.
          // 모달이 locale config 에 따라 필요한 필드만 쓰므로 둘 다 채워둔다.
          name: [address.first_name, address.last_name]
            .filter(Boolean)
            .join(" "),
          firstName: address.first_name ?? "",
          lastName: address.last_name ?? "",
          phone: address.phone ?? "",
          postalCode: address.postal_code ?? "",
          address1: address.address_1 ?? "",
          address2: address.address_2 ?? "",
          city: address.city ?? "",
          province: address.province ?? "",
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

  const memoSummary = formatShippingMemo(shippingMemo, tMemo)

  return (
    <section aria-labelledby="shipping-heading" className="mb-8 space-y-3">
      <h2 id="shipping-heading" className="sr-only">
        {t("title")}
      </h2>

      {!isValid ? (
        <div className="rounded-md border border-gray-200 bg-white px-[14px] py-[18px] lg:rounded-[10px] lg:px-10 lg:py-8">
          <EmptyAddressState
            onSelectSaved={() => setIsSelectorOpen(true)}
            onAddNew={handleAddNewAddress}
          />
        </div>
      ) : (
        <>
          <SectionCard
            title={t("title")}
            subtitle={addressName || name}
            action={{
              label: t("changeAddress"),
              onClick: () => setIsSelectorOpen(true),
            }}
          >
            <AddressDisplay
              phone={phone}
              postalCode={postalCode}
              address1={address1}
              address2={address2}
              fullAddress={fullAddress}
            />
          </SectionCard>

          <SectionCard
            title={tMemo("title")}
            action={{ label: t("change"), onClick: () => setIsMemoOpen(true) }}
          >
            <p
              className={
                memoSummary
                  ? "text-[13px] text-gray-800 lg:text-[15px]"
                  : "text-[13px] text-gray-400 lg:text-[15px]"
              }
            >
              {memoSummary || tMemo("empty")}
            </p>
          </SectionCard>

          <ShippingMemoDialog
            open={isMemoOpen}
            onOpenChange={setIsMemoOpen}
            shippingMemo={shippingMemo}
            onSubmit={onShippingMemoChange}
          />
        </>
      )}

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
