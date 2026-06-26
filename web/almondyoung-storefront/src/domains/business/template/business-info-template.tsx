"use client"

import { useState } from "react"

import { BusinessInfo, UserDetail } from "@/lib/types/ui/user"
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
    <div className="max-w-2xl py-6 md:min-h-screen md:py-8">
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
