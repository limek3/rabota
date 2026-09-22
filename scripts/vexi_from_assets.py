# -*- coding: utf-8 -*-
"""
Разложить исходники Vexi по всем размерам, которые нужны приложению.

Источник правды — четыре PNG в assets/vexi-src (нарисованы вручную, лежат вне
public специально: скрипт читает оттуда и пишет в public, поэтому его можно
запускать сколько угодно раз и результат не «поедет»):

    vexi-purple.png   обычное состояние, подсказки, логотип приложения
    vexi-gray.png     нет аватарки / только что зарегистрировался
    vexi-amber.png    предупреждение
    vexi-red.png      ошибка

Запуск:

    pip install pillow
    python scripts/vexi_from_assets.py

Что делает: обрезает пустые поля по общей рамке, добавляет одинаковый отступ,
режет размеры и пересобирает из фиолетовой мордочки логотип, фавикон и иконки
Electron. Ничего не дорисовывает — только кадрирует и масштабирует.

Про общую рамку. У исходников поля разные на пару пикселей. Если кадрировать
каждый по своему bbox, мордочки поедут по размеру относительно друг друга — а
они подменяются на одном и том же месте (аватарка, подсказка, тост), и разница
в полтора процента читается как дёрганье. Поэтому рамка одна на все четыре:
объединение их bbox.
"""

import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "vexi-src")
OUT = os.path.join(ROOT, "public", "vexi")
TONES = ("purple", "gray", "amber", "red")

# Поле вокруг мордочки, долей от её стороны. Мордочка должна занимать почти
# весь квадрат: VexiFace задаёт размер именно квадрату (аватарка 28px, подсказка
# 26px), и лишние поля внутри картинки читаются как «лису уменьшили».
PAD = 0.04


def load(tone):
    p = os.path.join(SRC, f"vexi-{tone}.png")
    if not os.path.exists(p):
        sys.exit(f"нет исходника {p}")
    return Image.open(p).convert("RGBA")


def common_box(images):
    """Общая квадратная рамка: объединяем bbox всех тонов и достраиваем до квадрата."""
    boxes = [im.split()[3].getbbox() for im in images]
    if any(b is None for b in boxes):
        sys.exit("исходник без прозрачности — ожидается PNG с альфой")
    l = min(b[0] for b in boxes)
    t = min(b[1] for b in boxes)
    r = max(b[2] for b in boxes)
    b = max(b[3] for b in boxes)
    side = round(max(r - l, b - t) * (1 + 2 * PAD))
    cx, cy = (l + r) / 2, (t + b) / 2
    return round(cx - side / 2), round(cy - side / 2), side


def normalized(im, box):
    """Кадрируем по общей рамке. Рамка может выходить за край — тогда докладываем
    прозрачные поля, а не сдвигаем мордочку внутрь квадрата."""
    x, y, side = box
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(im.crop((x, y, x + side, y + side)), (0, 0))
    return canvas


def main():
    os.makedirs(OUT, exist_ok=True)
    raw = {t: load(t) for t in TONES}
    box = common_box(list(raw.values()))
    faces = {t: normalized(im, box) for t, im in raw.items()}

    for t, im in faces.items():
        im.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f"vexi-{t}.png"))
        im.resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, f"vexi-{t}@128.png"))

    purple = faces["purple"]
    purple.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, "public", "brand-logo.png"))
    purple.resize((256, 256), Image.LANCZOS).save(os.path.join(ROOT, "app", "icon.png"))
    purple.resize((1024, 1024), Image.LANCZOS).save(os.path.join(ROOT, "electron", "icon.png"))
    purple.resize((32, 32), Image.LANCZOS).save(os.path.join(ROOT, "electron", "tray.png"))
    purple.resize((16, 16), Image.LANCZOS).save(os.path.join(ROOT, "electron", "tray16.png"))

    # macOS template icon: только альфа, цвет система задаёт сама
    for px, fname in ((16, "trayTemplate.png"), (32, "trayTemplate@2x.png")):
        a = purple.resize((px, px), Image.LANCZOS).split()[3]
        Image.merge("RGBA", (Image.new("L", (px, px), 0),) * 3 + (a,)).save(
            os.path.join(ROOT, "electron", fname)
        )

    # ASCII: консоль Windows по умолчанию cp1251 и на кириллице в stdout падает
    print(f"ok: crop {box[2]}x{box[2]} at ({box[0]},{box[1]}) -> public/vexi, brand-logo, app/icon, electron/*")


if __name__ == "__main__":
    main()
