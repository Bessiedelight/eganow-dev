import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { ConvexClientProvider } from "./ConvexClientProvider"
import { Toaster } from "@/components/ui/sonner"

const geist = Geist({subsets:['latin'],variable:'--font-sans'})
const fontMono = Geist_Mono({subsets: ["latin"],variable: "--font-mono"})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", geist.variable)}
    >
      <body>
        <ConvexClientProvider>
          <ThemeProvider>
            {children}
            <Toaster position="bottom-center" />
          </ThemeProvider>
        </ConvexClientProvider>
      </body>
    </html>
  )
}
