/**
 * PDF из одной картинки — без библиотек. Страница шириной A4 (595 pt), высота —
 * по пропорциям картинки, чтобы длинный лист не резался на куски. JPEG кладётся
 * в PDF как есть (DCTDecode), поэтому файл весит столько же, сколько сама картинка.
 */
export function jpegToPdf(jpeg: Uint8Array, widthPx: number, heightPx: number, title = ""): Blob {
  const pageW = 595.28;
  const pageH = Math.round((pageW * heightPx) / widthPx * 100) / 100;
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (b: Uint8Array | string) => {
    const u = typeof b === "string" ? enc.encode(b) : b;
    parts.push(u);
    size += u.length;
  };
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    if (typeof body === "string") push(body);
    else body();
    push("\nendobj\n");
  };
  // заголовок документа — строкой UTF-16BE: иначе кириллица в свойствах файла превращается в мусор
  const pdfText = (s: string) => {
    let hex = "FEFF";
    for (const ch of s) {
      const c = ch.codePointAt(0) ?? 63;
      if (c > 0xffff) continue;
      hex += c.toString(16).toUpperCase().padStart(4, "0");
    }
    return `<${hex}>`;
  };
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream");
  });
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(6, `<< /Title ${pdfText(title)} /Producer (LEADUP CRM) >>`);

  const xref = size;
  let table = `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

/** dataURL картинки → байты. */
export function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
