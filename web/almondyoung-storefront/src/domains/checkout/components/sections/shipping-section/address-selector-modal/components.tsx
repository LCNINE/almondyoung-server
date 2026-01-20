"use client"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Check, MapPin, MoreVertical, Pencil, Plus, Star, Trash2 } from "lucide-react"
import type { AddressCardProps } from "./types"
import { buildFullAddress, buildFullName, formatPhoneNumber } from "./utils"

export function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <MapPin className="mb-2 h-8 w-8 text-gray-400" />
      <p className="text-gray-500">저장된 배송지가 없습니다.</p>
    </div>
  )
}

export function LoadingState() {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="text-gray-500">불러오는 중...</div>
    </div>
  )
}

export function AddressCard({
  address,
  isSelected,
  isActionLoading,
  onSelect,
  onEdit,
  onSetDefault,
  onDelete,
}: AddressCardProps) {
  const fullAddress = buildFullAddress(address)
  const name = buildFullName(address)
  const addressName = address.address_name

  return (
    <div
      onClick={() => !isActionLoading && onSelect()}
      className={cn(
        "relative cursor-pointer rounded-lg border p-4 transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-gray-200 hover:border-gray-300",
        isActionLoading && "pointer-events-none opacity-50"
      )}
    >
      <div className="relative flex items-start justify-between">
        <div className="flex-1 pr-8">
          <div className="flex items-center gap-2">
            {addressName ? (
              <span className="font-medium text-gray-900">{addressName}</span>
            ) : null}
            <span
              className={
                addressName ? "text-sm text-gray-600" : "font-medium text-gray-900"
              }
            >
              {name}
            </span>
            {address.is_default_shipping ? (
              <span className="rounded bg-[#e8f6ea] px-2 py-0.5 text-[11px] font-semibold text-[#2ba24c]">
                기본 배송지
              </span>
            ) : null}
          </div>
          {address.phone ? (
            <p className="mt-1 text-sm text-gray-600">
              {formatPhoneNumber(address.phone)}
            </p>
          ) : null}
          <p className="mt-1 text-sm text-gray-600">{fullAddress}</p>
        </div>

        <div className="flex items-center gap-1">
          {isSelected ? (
            <Check className="absolute right-6 top-0 h-5 w-5 shrink-0 text-primary" />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="rounded p-1 hover:bg-gray-100"
              >
                <MoreVertical className="h-4 w-4 text-gray-500" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="mr-2 h-4 w-4" />
                수정
              </DropdownMenuItem>
              {!address.is_default_shipping ? (
                <DropdownMenuItem onClick={onSetDefault}>
                  <Star className="mr-2 h-4 w-4" />
                  기본 배송지로 설정
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                onClick={onDelete}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}

interface AddNewAddressButtonProps {
  onClick: () => void
}

export function AddNewAddressButton({ onClick }: AddNewAddressButtonProps) {
  return (
    <Button type="button" variant="outline" className="w-full" onClick={onClick}>
      <Plus className="mr-2 h-4 w-4" />새 배송지 추가
    </Button>
  )
}
