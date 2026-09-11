import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
const TITLE = "Parallax — Many agents. Many branches. One answer.";
const DESCRIPTION =
  "Parallax forks an isolated database per hypothesis, lets analyst agents explore concurrently with SQL, keyword and vector search, then synthesizes a cited report and remembers what it learned.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · Parallax" },
  description: DESCRIPTION,
  applicationName: "Parallax",
  keywords: ["multi-agent", "data analysis", "Hotdata", "RocketRide", "Cognee", "DuckDB", "swarm", "SQL"],
  icons: { icon: [{ url: "/favicon.svg", type: "image/svg+xml" }], shortcut: "/favicon.svg" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    siteName: "Parallax",
    type: "website",
    images: [{ url: "/og.svg", width: 1200, height: 630, alt: "Parallax — Many agents. Many branches. One answer." }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/og.svg"] },
};

export const viewport: Viewport = {
  themeColor: "#07090f",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-lg focus:bg-surface-2 focus:px-3 focus:py-2 focus:text-sm focus:text-text focus:ring-2 focus:ring-accent-2"
        >
          Skip to content
        </a>
        <Providers>
          <Nav />
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
            {children}
          </main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
