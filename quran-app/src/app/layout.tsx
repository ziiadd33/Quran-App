import type { Metadata, Viewport } from "next";
import { Inter, Amiri } from "next/font/google";
import { BottomNav } from "@/components/bottom-nav";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const amiri = Amiri({
  variable: "--font-amiri",
  weight: ["400", "700"],
  subsets: ["arabic"],
});

export const metadata: Metadata = {
  title: "Quran Recitation Processor",
  description: "Process and identify Quran recitation audio",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "QRP",
  },
};

export const viewport: Viewport = {
  themeColor: "#111010",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${amiri.variable} antialiased`}>
        <main className="relative z-10 mx-auto max-w-lg min-h-dvh pb-20 px-5 pt-4">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
