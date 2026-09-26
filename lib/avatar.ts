/**
 * Своя аватарка: картинку из файла обрезаем по центру в квадрат и сжимаем до 160×160
 * прямо в браузере. Получается data URL на ~5–15 КБ — он хранится в личных настройках
 * аккаунта (prefs.avatar) и уходит в базу вместе с ними, без отдельного хранилища файлов.
 */

const SIZE = 160;
const MAX_FILE = 15 * 1024 * 1024;

export async function fileToAvatar(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("это не картинка — выберите фото в JPG, PNG или WebP");
  if (file.size > MAX_FILE) throw new Error("файл больше 15 МБ — выберите фото поменьше");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("не получилось открыть картинку"));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error("пустая картинка");
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("браузер не умеет рисовать картинки");
    ctx.imageSmoothingQuality = "high";
    // квадрат из середины: лицо обычно по центру кадра
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    const webp = canvas.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
