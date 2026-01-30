"use server"

import { cookies as nextCookies } from "next/headers"

export interface InventoryRow {
  sku: string
  productName: string
  optionName?: string
  quantity: number
  status?: "pending" | "success" | "error"
  message?: string
}

export interface ProcessResult {
  success: boolean
  processedCount?: number
  failedCount?: number
  data?: InventoryRow[]
  error?: string
}

interface JwtPayload {
  actor_type?: "user" | "customer"
  actor_id?: string
  [key: string]: any
}

/**
 * JWT 토큰 payload 디코딩
 */
function decodeJwtPayload(token: string): JwtPayload | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) {
      return null
    }

    const payload = parts[1]
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const jsonPayload = Buffer.from(base64, "base64").toString("utf-8")

    return JSON.parse(jsonPayload)
  } catch {
    return null
  }
}


export async function checkAdminAccess(): Promise<boolean> {
  try {
    const cookies = await nextCookies()
    const token = cookies.get("_medusa_jwt")?.value

    if (!token) {
      return false
    }

    const payload = decodeJwtPayload(token)

    if (!payload) {
      return false
    }

    // user관리자 customer 고객
    return payload.actor_type === "user"
  } catch {
    return false
  }
}

// 엑셀 파일에서 재고 데이터를 파싱하고 WMS 재고 업데이트
export async function processInventoryExcel(
  formData: FormData
): Promise<ProcessResult> {
  // 관리자 권한 확인
  const isAdmin = await checkAdminAccess()
  if (!isAdmin) {
    return { success: false, error: "관리자 권한이 필요합니다." }
  }

  const file = formData.get("file") as File
  if (!file) {
    return { success: false, error: "파일이 없습니다." }
  }

  try {
    const buffer = await file.arrayBuffer()

    const XLSX = await import("xlsx")
    const workbook = XLSX.read(buffer, { type: "array" })
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]
    const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet)

    if (!jsonData || jsonData.length === 0) {
      return { success: false, error: "엑셀 파일에 데이터가 없습니다." }
    }

    const inventoryRows: InventoryRow[] = []

    // 셀메이트 실제 엑셀 양식 기반 필드 매칭
    for (const row of jsonData) {
      // 자체상품코드 필드 (셀메이트에서 "자체상품코드"로 제공)
      const sku =
        row["자체상품코드"] ||
        row["품목코드"] ||
        row["SKU"] ||
        row["sku"] ||
        row["상품코드"] ||
        row["품목 코드"]

      // 현재재고 필드
      const quantityRaw =
        row["현재재고"] ||
        row["재고수량"] ||
        row["재고"] ||
        row["수량"] ||
        row["가용재고"] ||
        row["실재고"]

      // 상품명
      const productName =
        row["상품명"] ||
        row["품목명"] ||
        row["품명"] ||
        row["product_name"] ||
        ""

      // 옵션명
      const optionName =
        row["옵션명"] ||
        row["선택옵션명"] ||
        row["option_name"] ||
        ""

      if (!sku) continue // SKU가 없으면 스킵

      const quantity = parseInt(String(quantityRaw), 10)
      if (isNaN(quantity)) continue // 수량이 숫자가 아니면 스킵

      inventoryRows.push({
        sku: String(sku).trim(),
        productName: String(productName).trim(),
        optionName: String(optionName).trim() || undefined,
        quantity: Math.max(0, quantity),
        status: "pending",
      })
    }

    if (inventoryRows.length === 0) {
      return {
        success: false,
        error: "유효한 재고 데이터가 없습니다. '자체상품코드'와 '현재재고' 컬럼을 확인하세요.",
      }
    }

    const cookies = await nextCookies()
    const token = cookies.get("_medusa_jwt")?.value

    let processedCount = 0
    let failedCount = 0

    // 병렬 처리 최적화 (React Best Practice: Promise.all 사용)
    const batchSize = 10 // 한 번에 10개씩 처리
    for (let i = 0; i < inventoryRows.length; i += batchSize) {
      const batch = inventoryRows.slice(i, i + batchSize)

      await Promise.all(
        batch.map(async (row) => {
          try {
            const result = await adjustWmsInventory(row.sku, row.quantity, token)

            if (result.success) {
              row.status = "success"
              processedCount++
            } else {
              row.status = "error"
              row.message = result.error
              failedCount++
            }
          } catch (error: any) {
            row.status = "error"
            row.message = error.message || "업데이트 실패"
            failedCount++
          }
        })
      )
    }

    return {
      success: processedCount > 0,
      processedCount,
      failedCount,
      data: inventoryRows,
    }
  } catch (error: any) {
    console.error("Excel processing error:", error)
    return {
      success: false,
      error: error.message || "파일 처리 중 오류가 발생했습니다.",
    }
  }
}


// WMS를 통한 재고 조정
async function adjustWmsInventory(
  cellmateSku: string,
  newQuantity: number,
  token?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!token) {
      return { success: false, error: "인증 토큰이 없습니다." }
    }

    const wmsUrl = process.env.NEXT_PUBLIC_WMS_URL || "http://localhost:3001"

    const headers = {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    }

    // 1. 셀메이트 SKU로 WMS SKU ID 조회
    const skuSearchResponse = await fetch(
      `${wmsUrl}/wms/skus?search=${encodeURIComponent(cellmateSku)}`,
      { headers }
    )

    if (!skuSearchResponse.ok) {
      return { success: false, error: `WMS SKU 조회 실패: ${skuSearchResponse.status}` }
    }

    const skuSearchData = await skuSearchResponse.json()
    const wmsSku = skuSearchData.data?.[0]

    if (!wmsSku?.id) {
      return { success: false, error: `WMS에서 SKU를 찾을 수 없음: ${cellmateSku}` }
    }

    // 2. 기본 창고 조회
    const warehouseResponse = await fetch(
      `${wmsUrl}/wms/locations/warehouses?limit=1`,
      { headers }
    )

    if (!warehouseResponse.ok) {
      return { success: false, error: "WMS 창고 조회 실패" }
    }

    const warehouseData = await warehouseResponse.json()
    const warehouse = warehouseData.data?.[0]

    if (!warehouse?.id) {
      return { success: false, error: "WMS 창고가 설정되지 않았습니다." }
    }

    // 3. 현재 재고 조회
    const currentStockResponse = await fetch(
      `${wmsUrl}/wms/inventory/stocks/summary?skuId=${wmsSku.id}&warehouseId=${warehouse.id}`,
      { headers }
    )

    let currentQuantity = 0
    if (currentStockResponse.ok) {
      const stockData = await currentStockResponse.json()
      currentQuantity = stockData[0]?.currentQuantity || 0
    }

    // 4. 재고 조정 (delta 계산)
    const delta = newQuantity - currentQuantity

    const adjustResponse = await fetch(
      `${wmsUrl}/wms/inventory/stocks/adjust`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          skuId: wmsSku.id,
          warehouseId: warehouse.id,
          delta: delta,
          reason: `셀메이트 재고 동기화 (${cellmateSku}): ${currentQuantity} → ${newQuantity}`,
        }),
      }
    )

    if (!adjustResponse.ok) {
      const errorText = await adjustResponse.text()
      return { success: false, error: `WMS 재고 조정 실패: ${errorText}` }
    }

    return { success: true }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
