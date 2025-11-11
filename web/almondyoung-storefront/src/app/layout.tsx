import { CartQuickButton } from "@components/cart/mobile-cart-quickButton"
import { FloatingButtons } from "@components/common/custom-buttons/floating-buttons"
import { ConditionalFooter } from "@components/layout/components/conditional-footer"
import { fetchCurrentUser } from "@lib/api/users"
import { CategoryProvider } from "@lib/providers/category-provider"
import { CustomThemeProvider } from "@lib/providers/custom-theme-provider"
import { ThemeProvider } from "@lib/providers/theme-provider"
import { renderSchemaTags } from "@lib/seo"
import { getBaseURL } from "@lib/utils/env"
import { Metadata } from "next"
import { Toaster } from "sonner"
import "styles/globals.css"
import categoriesData from "@lib/data/dummy/get-categories.json"
import { UserProvider } from "contexts/user-context"
import { OverlayProvider } from "overlay-kit"
export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  // 개발 중에는 static JSON 사용
  const categories = categoriesData.categories
  const currentUser = await fetchCurrentUser().catch(() => null)

  return (
    <html lang="ko" suppressHydrationWarning>
      <body className="overflow-x-clip [scrollbar-gutter:stable_both-edges]">
        <OverlayProvider>
          <CategoryProvider initialCategories={categories}>
            <UserProvider initialUser={currentUser}>
              <ThemeProvider
                attribute="class"
                defaultTheme="light"
                enableSystem={false}
                disableTransitionOnChange
              >
                <CustomThemeProvider>
                  <div className="relative">
                    {props.children}

                    <CartQuickButton />
                    <FloatingButtons />
                  </div>
                  <Toaster />
                </CustomThemeProvider>
              </ThemeProvider>
            </UserProvider>
            <ConditionalFooter />
          </CategoryProvider>
          {renderSchemaTags()}
        </OverlayProvider>
      </body>
    </html>
  )
}
