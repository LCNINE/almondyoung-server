"use client"

import CustomRadio from "@components/common/custom-radio"

// 현금영수증/세금계산서 섹션
export const ReceiptSection = ({
  cashReceiptOption,
  setCashReceiptOption,
  taxInvoiceOption,
  setTaxInvoiceOption,
}: {
  cashReceiptOption: string
  setCashReceiptOption: (value: string) => void
  taxInvoiceOption: string
  setTaxInvoiceOption: (value: string) => void
}) => (
  <section className="mb-8">
    <h2 className="mb-3 text-xl font-bold text-gray-900">
      현금영수증 / 세금계산서
    </h2>
    <div className="w-full space-y-4 rounded-lg bg-transparent py-4 md:space-y-6">
      {/* 현금영수증 */}
      <div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-0">
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
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-0">
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
        {taxInvoiceOption === "apply" && (
          <div className="mt-3 rounded-lg bg-[#fff] p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
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
    </div>
  </section>
)
