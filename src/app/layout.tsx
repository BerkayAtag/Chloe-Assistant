import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  applicationName: "Chloe Assistant",
  title: "Chloe Assistant — Personal AI Workspace",
  description:
    "A personal AI workspace for voice, research, creative work, and project development on macOS and the web.",
};

// İlk boyamadan önce temayı ayarla (FOUC önler)
const themeInitScript = `
(function () {
  try {
    var raw = localStorage.getItem('kisisel-ai-asistan:settings');
    var theme = raw ? (JSON.parse(raw).theme || 'dark') : 'dark';
    if (theme === 'dark' || theme === 'black') document.documentElement.classList.add('dark');
    if (theme === 'black') document.documentElement.classList.add('black');
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
