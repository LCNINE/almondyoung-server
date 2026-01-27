"use client"

import CustomRadio from "@/components/shared/custom-radio"
import { Button } from "@/components/ui/button"
import type { TaxInvoiceType } from "@/lib/types/ui/wallet"
import { useState } from "react"
import { TaxInvoiceModal } from "./tax-invoice-modal"

// 현금영수증/세금계산서 섹션
export const ReceiptSection = ({
  cashReceiptOption,
  setCashReceiptOption,
  taxInvoiceOption,
  setTaxInvoiceOption,
  taxInvoice,
}: {
  cashReceiptOption: string
  setCashReceiptOption: (value: string) => void
  taxInvoiceOption: string
  setTaxInvoiceOption: (value: string) => void
  taxInvoice?: TaxInvoiceType
}) => {
  const [taxInvoiceModalOpen, setTaxInvoiceModalOpen] = useState(false)

  const taxInvoiceData = taxInvoice?.defaultBusinessInfo

  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xl font-bold text-gray-900">
        현금영수증 / 세금계산서
      </h2>
      <div className="w-full space-y-4 rounded-lg bg-transparent py-4 lg:space-y-6">
        {/* 현금영수증 */}
        <div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-0">
            <h3 className="text-base font-bold">현금영수증</h3>
            <div className="flex items-center space-x-4">
              <CustomRadio
                label="신청함"
                name="cashReceipt"
                value="apply"
                checked={cashReceiptOption === "apply"}
                onChange={(e) => setCashReceiptOption(e.target.value)}
              />
              <CustomRadio
                label="신청안함"
                name="cashReceipt"
                value="noapply"
                checked={cashReceiptOption === "noapply"}
                onChange={(e) => setCashReceiptOption(e.target.value)}
              />
            </div>
          </div>
          {cashReceiptOption === "apply" && (
            <div className="mt-3 rounded-lg bg-[#fff] p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">사업자</p>
                  <p className="mt-1 text-sm text-gray-500">
                    바나뷰티 010-101010-1020
                  </p>
                </div>
                <button className="w-fit rounded border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">
                  변경
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 세금계산서 */}
        <div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-0">
            <h3 className="text-base font-bold">세금계산서</h3>
            <div className="flex items-center space-x-4">
              <CustomRadio
                label="신청함"
                name="taxInvoice"
                value="apply"
                checked={taxInvoiceOption === "apply"}
                onChange={(e) => setTaxInvoiceOption(e.target.value)}
              />
              <CustomRadio
                label="신청안함"
                name="taxInvoice"
                value="noapply"
                checked={taxInvoiceOption === "noapply"}
                onChange={(e) => setTaxInvoiceOption(e.target.value)}
              />
            </div>
          </div>

          {/* 신청함 선택 시 - 데이터 없음 */}
          {taxInvoiceOption === "apply" && !taxInvoiceData && (
            <div className="mt-3 rounded-lg bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <p className="text-sm text-gray-500">
                  등록된 세금계산서 정보가 없습니다.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTaxInvoiceModalOpen(true)}
                  className="w-fit shrink-0"
                >
                  추가
                </Button>
              </div>
            </div>
          )}

          {/* 신청함 선택 시 - 데이터 있음 */}
          {taxInvoiceOption === "apply" && taxInvoiceData && (
            <div className="mt-3 rounded-lg bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-semibold text-gray-800">
                    {taxInvoiceData.name}
                  </p>
                  <p className="text-sm text-gray-500">
                    사업자등록번호: {taxInvoiceData.businessNumber}
                  </p>
                  <p className="text-sm text-gray-500">
                    대표자: {taxInvoiceData.ownerName}
                  </p>
                  <p className="text-sm text-gray-500">
                    {taxInvoiceData.address}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setTaxInvoiceModalOpen(true)}
                  className="w-fit shrink-0"
                >
                  변경
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 세금계산서 모달 */}
      <TaxInvoiceModal
        open={taxInvoiceModalOpen}
        onOpenChange={setTaxInvoiceModalOpen}
        initialData={taxInvoiceData}
      />
    </section>
  )
}
