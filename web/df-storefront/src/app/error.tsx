"use client"

export default function Error({
  error: _error,
}: {
  error: Error & { digest?: string }
}) {
  return (
    <div className="content-container py-16">
      <h1 className="text-2xl font-medium">Something went wrong</h1>
      <p className="mt-4 text-ui-fg-subtle">
        Please refresh the page and try again.
      </p>
    </div>
  )
}
