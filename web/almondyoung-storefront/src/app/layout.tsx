import { CartQuickButton } from "@components/cart/mobile-cart-quickButton"
import { FloatingButtons } from "@components/common/custom-buttons/floating-buttons"
import { BottomNavigation } from "@components/layout/components/bottom-nav"
import Footer from "@components/layout/components/footer"
import { fetchMe } from "@lib/api/users/me"
import { CustomThemeProvider } from "@lib/providers/custom-theme-provider"
import { ThemeProvider } from "@lib/providers/theme-provider"
import { getSEOTags, renderSchemaTags } from "@lib/seo"
import { UserProvider } from "@/contexts/user-context"
import { Metadata } from "next"
import { OverlayProvider } from "overlay-kit"
import { Toaster } from "sonner"
import "@/styles/globals.css"

export const metadata: Metadata = getSEOTags({
  title: {
    default: "아몬드영 | 미용재료 MRO 쇼핑몰",
    template: "%s | 아몬드영",
  },
  description: "미용 전문가를 위한 최저가 쇼핑몰",
  openGraph: {
    title: "아몬드영 | 미용재료 MRO 쇼핑몰",
    description: "미용 전문가를 위한 최저가 쇼핑몰",
  },
  extraTags: {
    icons: {
      icon: "/favicon.ico",
    },
  },
})

export default async function RootLayout(props: { children: React.ReactNode }) {
  const user = await fetchMe().catch(() => null)

  return (
    <html lang="ko" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="overflow-x-clip [scrollbar-gutter:stable_both-edges]"
      >
        <OverlayProvider>
          <UserProvider initialUser={user}>
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
          {renderSchemaTags()}
        </OverlayProvider>
      </body>
    </html>
  )
}
