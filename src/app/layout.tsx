import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "K-VERSATION Visual Editor",
  description: "Turn narration audio into a sparse, intentional visual timeline and render it to MP4.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <header className="border-b border-zinc-800">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              K-VERSATION <span className="text-zinc-400">Visual Editor</span>
            </Link>
            <nav className="text-sm text-zinc-400">
              <Link href="/" className="hover:text-zinc-100">
                Projects
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
