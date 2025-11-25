import { CartQuickButton } from "@components/cart/mobile-cart-quickButton"
import { FloatingButtons } from "@components/common/custom-buttons/floating-buttons"
import { BottomNavigation } from "@components/layout/components/bottom-nav"
import Footer from "@components/layout/components/footer"
import { fetchMe } from "@lib/api/users/me"
import categoriesData from "@lib/data/dummy/get-categories.json"
import { CategoryProvider } from "@lib/providers/category-provider"
import { CustomThemeProvider } from "@lib/providers/custom-theme-provider"
import { ThemeProvider } from "@lib/providers/theme-provider"
import { renderSchemaTags } from "@lib/seo"
import { getBaseURL } from "@lib/utils/env"
import { UserProvider } from "contexts/user-context"
import { Metadata } from "next"
import { OverlayProvider } from "overlay-kit"
import { Toaster } from "sonner"
import "styles/globals.css"
export const metadata: Metadata = {
  metadataBase: new URL(getBaseURL()),
}

export default async function RootLayout(props: { children: React.ReactNode }) {
  // 개발 중에는 static JSON 사용
  const categories = categoriesData.categories
  const currentUser = await fetchMe().catch(() => null)

  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="overflow-x-clip [scrollbar-gutter:stable_both-edges]"
      >
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
            <Footer />
            <BottomNavigation />
          </CategoryProvider>
          {renderSchemaTags()}
        </OverlayProvider>
      </body>
    </html>
  )
}
