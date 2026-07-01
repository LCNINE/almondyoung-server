"use client"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  deleteCustomerAddress,
  getCustomerAddresses,
  setDefaultShippingAddress,
} from "@/lib/api/medusa/customer"
import { buildAddressLine } from "@/lib/utils/address-line"
import { formatPhoneNumber } from "@/lib/utils/format-phone-number"
import { HttpTypes } from "@medusajs/types"
import { MapPin, MoreVertical, Pencil, Plus, Star, Trash2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ShippingAddressModal } from "@/components/address"
import type { EditAddressState } from "@/domains/checkout/components/sections/shipping/types"

export function AddressBookSection() {
  const t = useTranslations("mypage.account.address")
  const tLabels = useTranslations("mypage.account.labels")
  const [addresses, setAddresses] = useState<HttpTypes.StoreCustomerAddress[]>(
    []
  )
  const [isLoading, setIsLoading] = useState(true)
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalMode, setModalMode] = useState<"create" | "edit">("create")
  const [editAddressId, setEditAddressId] = useState<string | undefined>()
  const [editDefaults, setEditDefaults] = useState<
    EditAddressState["defaultValues"] | undefined
  >()

  const fetchAddresses = useCallback(async () => {
    try {
      const result = await getCustomerAddresses()
      setAddresses(result ?? [])
    } catch {
      // 무시
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAddresses()
  }, [fetchAddresses])

  const handleAddNew = () => {
    setModalMode("create")
    setEditAddressId(undefined)
    setEditDefaults(undefined)
    setIsModalOpen(true)
  }

  const handleEdit = (address: HttpTypes.StoreCustomerAddress) => {
    setModalMode("edit")
    setEditAddressId(address.id)

    const name = [address.first_name, address.last_name]
      .filter(Boolean)
      .join(" ")

    setEditDefaults({
      addressName:
        (address.metadata?.shipping_address_name as string) ??
        address.address_name ??
        "",
      name,
      phone: address.phone ?? "",
      postalCode: address.postal_code ?? "",
      address1: address.address_1 ?? "",
      address2: address.address_2 ?? "",
      isDefaultShipping: address.is_default_shipping ?? false,
      metadata: (address.metadata as Record<string, unknown>) ?? {},
    })

    setIsModalOpen(true)
  }

  const handleSetDefault = async (addressId: string) => {
    setActionLoadingId(addressId)
    try {
      const result = await setDefaultShippingAddress(addressId)
      if (result.success) {
        toast.success(t("setDefaultSuccess"))
        await fetchAddresses()
      } else {
        toast.error(t("setDefaultFailed"))
      }
    } catch {
      toast.error(t("setDefaultFailed"))
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleDelete = async (addressId: string) => {
    if (!confirm(t("deleteConfirm"))) return

    setActionLoadingId(addressId)
    try {
      const result = await deleteCustomerAddress(addressId)
      if (result.success) {
        toast.success(t("deleted"))
        await fetchAddresses()
      } else {
        toast.error(t("deleteFailed"))
      }
    } catch {
      toast.error(t("deleteFailed"))
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleModalSuccess = () => {
    fetchAddresses()
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{t("title")}</CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddNew}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {t("add")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-gray-500">{t("loading")}</p>
            </div>
          ) : addresses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <MapPin className="mb-3 h-8 w-8 text-gray-300" />
              <p className="mb-1 text-sm text-gray-500">{t("emptyTitle")}</p>
              <p className="text-xs text-gray-400">{t("emptyDescription")}</p>
            </div>
          ) : (
            <div className="max-h-[400px] space-y-3 overflow-y-auto pr-1">
              {[...addresses]
                .sort((a, b) => {
                  if (a.is_default_shipping && !b.is_default_shipping) return -1
                  if (!a.is_default_shipping && b.is_default_shipping) return 1
                  return 0
                })
                .map((address) => {
                  const fullAddress = buildAddressLine({
                    province: address.province,
                    city: address.city,
                    address1: address.address_1,
                    address2: address.address_2,
                  })
                  const name = [address.first_name, address.last_name]
                    .filter(Boolean)
                    .join(" ")
                  const addressName =
                    (address.metadata?.shipping_address_name as string) ??
                    address.address_name
                  const postalCode = address.postal_code ?? ""
                  const address1 = address.address_1 ?? ""
                  const address2 = address.address_2 ?? ""
                  const isActionLoading = actionLoadingId === address.id

                  return (
                    <div
                      key={address.id}
                      className={`relative rounded-lg border border-gray-200 p-4 transition-colors hover:border-gray-300 ${
                        isActionLoading ? "pointer-events-none opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 pr-8">
                          <div className="flex items-center gap-2">
                            {addressName && (
                              <span className="font-medium text-gray-900">
                                {addressName}
                              </span>
                            )}
                            <span
                              className={
                                addressName
                                  ? "text-sm text-gray-600"
                                  : "font-medium text-gray-900"
                              }
                            >
                              {name}
                            </span>
                            {address.is_default_shipping && (
                              <span className="rounded bg-[#e8f6ea] px-2 py-0.5 text-[11px] font-semibold text-[#2ba24c]">
                                {t("defaultBadge")}
                              </span>
                            )}
                          </div>
                          {address.phone && (
                            <p className="mt-1 text-sm text-gray-600">
                              {formatPhoneNumber(address.phone)}
                            </p>
                          )}
                          <dl className="mt-1 space-y-1 text-sm text-gray-600">
                            <AddressRow
                              label={tLabels("postcode")}
                              value={postalCode}
                            />
                            <AddressRow
                              label={tLabels("address")}
                              value={address1 || fullAddress}
                            />
                            <AddressRow
                              label={tLabels("addressDetail")}
                              value={address2}
                            />
                          </dl>
                        </div>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              className="rounded p-1 hover:bg-gray-100"
                            >
                              <MoreVertical className="h-4 w-4 text-gray-500" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() => handleEdit(address)}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              {t("edit")}
                            </DropdownMenuItem>
                            {!address.is_default_shipping && (
                              <DropdownMenuItem
                                onClick={() => handleSetDefault(address.id)}
                              >
                                <Star className="mr-2 h-4 w-4" />
                                {t("setDefault")}
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onClick={() => handleDelete(address.id)}
                              className="text-red-600 focus:text-red-600"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              {t("delete")}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </CardContent>
      </Card>

      <ShippingAddressModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        mode={modalMode}
        addressId={editAddressId}
        defaultValues={editDefaults}
        onSuccess={handleModalSuccess}
      />
    </>
  )
}

function AddressRow({
  label,
  value,
}: {
  label: string
  value?: string | null
}) {
  return (
    <div className="flex items-start gap-2">
      <dt className="min-w-14 text-gray-500">{label}</dt>
      <dd className="text-gray-600">{value || "-"}</dd>
    </div>
  )
}
