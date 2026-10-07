"use client";

import { useCrm } from "@/lib/crm/store";
import { TAX_PCT, withTax } from "@/lib/crm/payroll";
import { fmtMoney } from "@/lib/crm/format";
import { Icon } from "@/components/ui/icons";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // старый WebView / нет разрешения — через временное поле
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Остаток + налог самозанятого: сумма к переводу и кнопка «скопировать» —
 * в буфер уходят только цифры, чтобы вставить в банк.
 */
export function TaxSum({ value, copy = true }: { value: number; copy?: boolean }) {
  const { toast } = useCrm();
  const sum = withTax(value);
  if (!sum) return <span className="muted">—</span>;
  return (
    <span className="row" style={{ gap: 4, justifyContent: "flex-end", display: "inline-flex" }}>
      {fmtMoney(sum)}
      {copy && (
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          style={{ width: 22, height: 22, minHeight: 0, padding: 0 }}
          title={`Скопировать ${sum} — остаток ÷ 0,94 (налог ${TAX_PCT}%)`}
          aria-label="Скопировать сумму с налогом"
          onClick={async (e) => {
            e.stopPropagation();
            if (await copyText(String(sum))) toast(`Скопировано: ${fmtMoney(sum)}`);
            else toast("Не удалось скопировать", "err");
          }}
        >
          <Icon name="copy" size={12} />
        </button>
      )}
    </span>
  );
}
