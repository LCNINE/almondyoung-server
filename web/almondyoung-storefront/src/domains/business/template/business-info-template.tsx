"use client"

import type { BusinessInfo } from "@lib/types/dto/business"
import { ArrowLeft } from "lucide-react"
import { useState } from "react"
import { UserDetail } from "types/global"
import BusinessDisplay from "../components/business-display"
import BusinessEmpty from "../components/business-empty"
import BusinessForm from "../components/business-form"

export type ViewMode = "display" | "edit" | "register" | "empty"

export default function BusinessInfoTemplate({
  user,
  business,
}: {
  user: UserDetail
  business: BusinessInfo | null
}) {
  const [viewMode, setViewMode] = useState<ViewMode>(
    business ? "display" : "empty"
  )

  const handleCancel = () => {
    setViewMode(business ? "display" : "empty")
  }

  const handleEdit = () => {
    setViewMode("edit")
  }

  return (
    <div className="px-4 py-6 md:min-h-screen md:px-8 md:py-8">
      <div className="mb-6 flex items-center gap-3">
        {(viewMode === "edit" || viewMode === "register") && (
          <button
            onClick={handleCancel}
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex h-8 w-8 items-center justify-center rounded-md transition-colors md:hidden"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* 콘텐츠 */}
      {viewMode === "empty" && (
        <BusinessEmpty onRegister={() => setViewMode("register")} />
      )}

      {viewMode === "display" && business && (
        <BusinessDisplay data={business} onEdit={handleEdit} />
      )}

      {viewMode === "register" && (
        <BusinessForm
          viewMode={viewMode}
          setViewMode={setViewMode}
          onCancel={handleCancel}
          isEditing={false}
        />
      )}
      {viewMode === "edit" && business && (
        <BusinessForm
          initialData={business}
          viewMode={viewMode}
          setViewMode={setViewMode}
          onCancel={handleCancel}
          isEditing={true}
        />
      )}
    </div>
  )
}
