import type { Metadata } from "next"

import { auth } from "@/auth"
import { AppSessionProvider } from "@/components/providers/session-provider"
import "./globals.css"
import { Geist, Geist_Mono } from "next/font/google"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Messenger CRM",
  description: "多言語チャットと相談管理のための CRM",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth()

  return (
    <html lang="ja">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}>
        <AppSessionProvider session={session}>{children}</AppSessionProvider>
      </body>
    </html>
  )
}
