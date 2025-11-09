//このファイルは Next.js アプリケーションの基盤となる部分で、
// すべてのページで共有される共通のレイアウトやスタイル、メタデータを
// 定義しています。フォントの設定やグローバルスタイルの適用、
// SEO対策のためのメタデータなど、アプリケーション全体に影響する重要な設定が含まれています。

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ProblemConfigProvider } from "../components/problem-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Object-Class Converter",
  description: "Learning tool for object diagrams and class diagrams",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>
        <ProblemConfigProvider>{children}</ProblemConfigProvider>
      </body>
    </html>
  );
}
