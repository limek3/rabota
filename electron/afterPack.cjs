/**
 * Ad-hoc подпись macOS-сборки.
 *
 * Зачем: на Apple silicon система отказывается запускать бинарник с
 * НЕВАЛИДНОЙ подписью. electron-builder переименовывает исполняемый файл и
 * докладывает ресурсы в бандл — подпись, с которой Electron приехал из
 * апстрима, после этого перестаёт сходиться. Без пересборки подписи
 * пользователь получает не предупреждение Gatekeeper, а мгновенный вылет.
 *
 * Ad-hoc подпись (`codesign -s -`) — подпись без сертификата: она делает
 * бандл валидным для ядра, но не делает его доверенным для Gatekeeper. То
 * есть приложение запустится, но при первом открытии macOS всё равно спросит
 * подтверждение (правый клик → «Открыть»), потому что нет нотаризации.
 *
 * Когда появится сертификат Apple Developer, этот хук сам отойдёт в сторону:
 * при настроенной подписи electron-builder подпишет всё сам, и мы выходим
 * первой строкой.
 */

const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;

  // Настоящая подпись есть — electron-builder уже всё сделал сам.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
    console.log(`  • ad-hoc signed  ${appName}`);
  } catch (e) {
    // Не роняем сборку: .dmg соберётся и так, просто на Apple silicon его
    // придётся чинить вручную (codesign -s - /Applications/Vexi.app).
    console.warn(`  ⚠ ad-hoc signing failed: ${e.message}`);
  }
};
