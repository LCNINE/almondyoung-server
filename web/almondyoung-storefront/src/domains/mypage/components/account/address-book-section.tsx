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
import { formatPhoneNumber } from "@/lib/utils/format-phone-number"
import { HttpTypes } from "@medusajs/types"
import { MapPin, MoreVertical, Pencil, Plus, Star, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { ShippingAddressModal } from "@/components/address"
import type { EditAddressState } from "@/domains/checkout/components/sections/shipping/types"

export function AddressBookSection() {
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
        toast.success("기본 배송지로 설정되었습니다.")
        await fetchAddresses()
      } else {
        toast.error("기본 배송지 설정에 실패했습니다.")
      }
    } catch {
      toast.error("기본 배송지 설정에 실패했습니다.")
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleDelete = async (addressId: string) => {
    if (!confirm("이 배송지를 삭제하시겠습니까?")) return

    setActionLoadingId(addressId)
    try {
      const result = await deleteCustomerAddress(addressId)
      if (result.success) {
        toast.success("배송지가 삭제되었습니다.")
        await fetchAddresses()
      } else {
        toast.error("배송지 삭제에 실패했습니다.")
      }
    } catch {
      toast.error("배송지 삭제에 실패했습니다.")
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
              <CardTitle className="text-lg">배송지 관리</CardTitle>
              <CardDescription>
                자주 사용하는 배송지를 등록하고 관리할 수 있습니다.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddNew}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              추가
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <p className="text-sm text-gray-500">불러오는 중...</p>
            </div>
          ) : addresses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10">
              <MapPin className="mb-3 h-8 w-8 text-gray-300" />
              <p className="mb-1 text-sm text-gray-500">
                등록된 배송지가 없습니다.
              </p>
              <p className="text-xs text-gray-400">
                배송지를 추가하면 주문 시 빠르게 입력할 수 있습니다.
              </p>
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
                const fullAddress = [address.address_1, address.address_2]
                  .filter(Boolean)
                  .join(" ")
                const name = [address.first_name, address.last_name]
                  .filter(Boolean)
                  .join(" ")
                const addressName =
                  (address.metadata?.shipping_address_name as string) ??
                  address.address_name
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
                              기본 배송지
                            </span>
                          )}
                        </div>
                        {address.phone && (
                          <p className="mt-1 text-sm text-gray-600">
                            {formatPhoneNumber(address.phone)}
                          </p>
                        )}
                        <p className="mt-1 text-sm text-gray-600">
                          {fullAddress}
                        </p>
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
                          <DropdownMenuItem onClick={() => handleEdit(address)}>
                            <Pencil className="mr-2 h-4 w-4" />
                            수정
                          </DropdownMenuItem>
                          {!address.is_default_shipping && (
                            <DropdownMenuItem
                              onClick={() => handleSetDefault(address.id)}
                            >
                              <Star className="mr-2 h-4 w-4" />
                              기본 배송지로 설정
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onClick={() => handleDelete(address.id)}
                            className="text-red-600 focus:text-red-600"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            삭제
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
