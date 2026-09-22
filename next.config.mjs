import { createRequire } from "node:module";

// Версия приложения — из package.json, а не константой в компоненте: экран
// настроек показывает её рядом с «Проверить обновления», и разъехавшееся с
// установщиком число там хуже, чем отсутствие числа.
const { version } = createRequire(import.meta.url)("./package.json");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export so the Electron shell (electron/main.js) can serve ./out
  // without a Node server. `next dev` works as usual.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
