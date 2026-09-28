import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "NextCode | Engine Orchestration Workspace",
  description: "Plataforma modular local-first com Next.js 15, Prisma, DAG e MCP Protocol",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="antialiased h-screen overflow-hidden bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
