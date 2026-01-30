"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import {
  Upload,
  FileSpreadsheet,
  CheckCircle,
  AlertCircle,
  Loader2,
  ShieldAlert,
} from "lucide-react"
import { toast } from "sonner"
import { processInventoryExcel, checkAdminAccess, checkAdminScope, type InventoryRow } from "@lib/api/admin/inventory"
import { medusaSigninAdmin } from "@lib/api/medusa/signin"

export default function AdminInventoryPage() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [inventoryData, setInventoryData] = useState<InventoryRow[]>([])
  const [uploadStatus, setUploadStatus] = useState<
    "idle" | "parsed" | "processing" | "done"
  >("idle")
  const [hasAccess, setHasAccess] = useState<boolean | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function initializeAdminAccess() {
      // 1. accessToken의 scope 확인
      const { isAdmin } = await checkAdminScope()

      if (!isAdmin) {
        setHasAccess(false)
        return
      }

      // 2. Medusa JWT의 actor_type 확인
      const hasAccess = await checkAdminAccess()

      // 3. actor_type이 "user"가 아니면 medusaSigninAdmin 호출
      if (!hasAccess) {
        try {
          const result = await medusaSigninAdmin()

          if (result.success) {
            // 성공 후 다시 확인
            const recheckAccess = await checkAdminAccess()
            setHasAccess(recheckAccess)

            if (recheckAccess) {
              toast.success("관리자 권한이 활성화되었습니다.")
            } else {
              toast.error("관리자 권한 활성화에 실패했습니다.")
            }
          } else {
            setHasAccess(false)
            toast.error("관리자 인증에 실패했습니다.")
          }
        } catch (error) {
          console.error("Admin signin error:", error)
          setHasAccess(false)
          toast.error("관리자 인증 중 오류가 발생했습니다.")
        }
      } else {
        setHasAccess(true)
      }
    }

    initializeAdminAccess()
  }, [])

  const handleFile = useCallback(async (file: File) => {
    // 엑셀 파일인지 확인
    const validExtensions = [".xlsx", ".xls", ".csv"]
    const hasValidExtension = validExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    )

    if (!hasValidExtension) {
      toast.error("엑셀 파일(.xlsx, .xls) 또는 CSV 파일만 업로드 가능합니다.")
      return
    }

    setIsProcessing(true)
    setUploadStatus("processing")

    try {
      const formData = new FormData()
      formData.append("file", file)

      const result = await processInventoryExcel(formData)

      if (result.success) {
        setInventoryData(result.data || [])
        setUploadStatus("done")
        toast.success(
          `${result.processedCount}개 상품 재고가 업데이트되었습니다.`
        )
        if (result.failedCount && result.failedCount > 0) {
          toast.warning(`${result.failedCount}개 상품 업데이트 실패`)
        }
      } else {
        toast.error(result.error || "재고 업데이트에 실패했습니다.")
        setUploadStatus("idle")
      }
    } catch (error) {
      console.error("Excel processing error:", error)
      toast.error("파일 처리 중 오류가 발생했습니다.")
      setUploadStatus("idle")
    } finally {
      setIsProcessing(false)
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => {
    setIsDragging(false)
  }

  // 권한 체크 중
  if (hasAccess === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
      </div>
    )
  }

  // 권한 없음
  if (!hasAccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-4">
        <ShieldAlert className="h-16 w-16 text-red-400" />
        <h1 className="mt-4 text-xl font-bold text-gray-900">접근 권한 없음</h1>
        <p className="mt-2 text-gray-600">
          이 페이지는 관리자만 접근할 수 있습니다.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">재고 일괄 업데이트</h1>
          <p className="mt-2 text-sm text-gray-600">
            셀메이트에서 다운로드한 재고 엑셀 파일을 업로드하여 재고를
            업데이트합니다.
          </p>
        </div>

        {/* 파일 업로드 영역 */}
        <div
          onClick={() => !isProcessing && fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className={`
            rounded-xl border-2 border-dashed p-8 text-center transition-colors
            ${isDragging ? "border-yellow-400 bg-yellow-50" : "border-gray-300 bg-white"}
            ${isProcessing ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-yellow-400 hover:bg-yellow-50"}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
            disabled={isProcessing}
          />
          <div className="flex flex-col items-center gap-4">
            {isProcessing ? (
              <Loader2 className="h-12 w-12 animate-spin text-yellow-500" />
            ) : (
              <Upload className="h-12 w-12 text-gray-400" />
            )}
            <div>
              <p className="text-lg font-medium text-gray-700">
                {isProcessing
                  ? "재고 업데이트 중..."
                  : isDragging
                    ? "파일을 여기에 놓으세요"
                    : "엑셀 파일을 드래그하거나 클릭하여 업로드"}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                지원 형식: .xlsx, .xls, .csv
              </p>
            </div>
          </div>
        </div>

        {/* 예상 엑셀 양식 안내 */}
        <div className="mt-6 rounded-lg bg-blue-50 p-4">
          <div className="flex items-start gap-3">
            <FileSpreadsheet className="h-5 w-5 shrink-0 text-blue-500" />
            <div>
              <h3 className="font-medium text-blue-900">셀메이트 엑셀 양식 안내</h3>
              <p className="mt-1 text-sm text-blue-700">
                셀메이트에서 <strong>개발팀양식</strong>으로 다운로드한 재고 엑셀 파일을 업로드하세요.
              </p>
              <ul className="mt-2 list-inside list-disc text-sm text-blue-700">
                <li>
                  <strong>자체상품코드</strong>: Medusa SKU와 매칭
                </li>
                <li>
                  <strong>현재재고</strong>: 업데이트할 재고 수량
                </li>
                <li>
                  <strong>상품명</strong>, <strong>옵션명</strong>: 결과 확인용
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* 처리 결과 */}
        {uploadStatus === "done" && inventoryData.length > 0 && (
          <div className="mt-8">
            <h2 className="mb-4 text-lg font-semibold">처리 결과</h2>
            <div className="overflow-hidden rounded-lg border bg-white">
              <div className="max-h-96 overflow-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        자체상품코드
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        상품명
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        옵션명
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        현재재고
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                        상태
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {inventoryData.map((row, index) => (
                      <tr key={index}>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-gray-900">
                          {row.sku}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {row.productName || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {row.optionName || "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                          {row.quantity}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-sm">
                          {row.status === "success" ? (
                            <span className="flex items-center gap-1 text-green-600">
                              <CheckCircle className="h-4 w-4" />
                              성공
                            </span>
                          ) : row.status === "error" ? (
                            <span
                              className="flex items-center gap-1 text-red-600"
                              title={row.message}
                            >
                              <AlertCircle className="h-4 w-4" />
                              {row.message || "실패"}
                            </span>
                          ) : (
                            <span className="text-gray-500">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 요약 */}
            <div className="mt-4 flex gap-4 text-sm">
              <span className="text-green-600">
                성공: {inventoryData.filter((r) => r.status === "success").length}
              </span>
              <span className="text-red-600">
                실패: {inventoryData.filter((r) => r.status === "error").length}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
