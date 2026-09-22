import type { Metadata } from "next";
import localFont from "next/font/local";
import { TitleBar } from "@/components/TitleBar";
import "./globals.css";
import "./crm.css";
import "./learn.css";

// Шрифты лежат локально (./fonts): сборка не зависит от сети.
// Inter — весь текст (латиница + кириллица), JetBrains Mono — цифры.
// Кириллица обязательна: интерфейс русский, и шрифт без неё раскладывает
// строку двумя гарнитурами сразу — буквы системным фолбэком, латиница своим.
const ui = localFont({
  src: [
    { path: "./fonts/inter-400.woff", weight: "400", style: "normal" },
    { path: "./fonts/inter-500.woff", weight: "500", style: "normal" },
    { path: "./fonts/inter-600.woff", weight: "600", style: "normal" },
    { path: "./fonts/inter-700.woff", weight: "700", style: "normal" },
  ],
  variable: "--font-ui",
  display: "swap",
});

const jetBrainsMono = localFont({
  src: [
    { path: "./fonts/jetbrains-mono-400.ttf", weight: "400", style: "normal" },
    { path: "./fonts/jetbrains-mono-500.ttf", weight: "500", style: "normal" },
    { path: "./fonts/jetbrains-mono-600.ttf", weight: "600", style: "normal" },
    { path: "./fonts/jetbrains-mono-700.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "LEADUP CRM", template: "%s · LEADUP" },
  description: "Операционная система руководителя отдела лидогенерации",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" data-theme="light" className={`${ui.variable} ${jetBrainsMono.variable}`} suppressHydrationWarning>
      <body>
        {/* Тема — до первой отрисовки, чтобы тёмная тема не мигала светлой. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('leadup.theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t;}catch(e){}",
          }}
        />
        {/* заголовок окна Electron — в браузере ничего не рисует */}
        <TitleBar />
        {children}
      </body>
    </html>
  );
}
