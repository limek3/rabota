# Стадии стройки — промпты для GPT

Для каждого из 10 зданий — **2 картинки стройки** (готовое здание у вас уже есть):

| Стадия | Когда показываем | Файл |
|---|---|---|
| 1. Котлован и каркас | вложено 1–49% | `<id>-s1.png` |
| 2. Стены в лесах | вложено 50–99% | `<id>-s2.png` |
| 3. Готово | 100% | `<id>.png` (уже есть) |

`<id>`: cafe, flowers, shop, pizza, service, autosalon, bank, hotel, office, stadium

## Как генерировать
1. Всё в **том же чате**, где делали здания (так GPT держит стиль).
2. Каждую стадию делайте **правкой готового здания**: приложите `<id>.png` и дайте промпт ниже. Тогда основание, угол и размер совпадут, и стадии будут сменять друг друга на одном месте.
3. Проверьте: прозрачный фон, тот же ромб-основание, тот же ракурс, без надписей.

## Стадия 1 — котлован и каркас (`-s1`)
Приложить готовое здание:
```
Edit the attached image: show the very same building at an EARLY construction stage, on exactly the same diamond base tile,
same isometric angle, same size and position, same lighting and render style. Transparent background, no text, no logos, no people.

Show: a fresh concrete foundation slab with the building's footprint, a bare structural frame of the first floor
(steel beams or wooden studs, no walls yet), wooden scaffolding along one or two sides, a small yellow construction crane
on the tile, a few stacks of bricks and wooden planks, an orange-and-white barrier fence around the edge of the tile,
a cement mixer. The height of the frame is about one third of the finished building. Clean, cute, toy-like 3D look.
```

## Стадия 2 — стены в лесах (`-s2`)
Приложить готовое здание:
```
Edit the attached image: show the very same building at a LATE construction stage, on exactly the same diamond base tile,
same isometric angle, same size and position, same lighting and render style. Transparent background, no text, no logos, no people.

Show: the building has its full shape and height, walls are built but unfinished — bare grey plaster or raw bricks
instead of final paint, empty window openings without glass, no awnings, no signs, no plants or furniture yet.
Wooden scaffolding with planks wraps around the front walls, a few green protective construction nets hang from it,
a small yellow crane next to the building, stacks of materials and a wheelbarrow on the tile, an orange-and-white
barrier fence around the edge of the tile. Clean, cute, toy-like 3D look.
```

## Стадион — особый случай
У стадиона нет «этажей», поэтому для него своё:

**`stadium-s1`:**
```
Edit the attached image: the same stadium at an EARLY construction stage on exactly the same base, angle, size, lighting and style.
Transparent background, no text, no logos, no people.
Show: the round concrete foundation ring, the first low tier of bare concrete stands only on one side, steel beams sticking up,
bare brown soil instead of the green pitch, two yellow cranes, stacks of materials, an orange-and-white barrier fence around the base.
```

**`stadium-s2`:**
```
Edit the attached image: the same stadium at a LATE construction stage on exactly the same base, angle, size, lighting and style.
Transparent background, no text, no logos, no people.
Show: all stands are built in raw grey concrete without colored seats, the pitch is fresh soil with the first green turf rolls
laid in strips, floodlight towers stand but have no lamps yet, scaffolding on one side, one yellow crane, materials on the base.
```

## Если стадия «поплыла»
Если GPT сдвинул здание или поменял ракурс, повторите правку с припиской:
```
Keep the base tile, camera angle, size and position pixel-identical to the attached image — change only the building itself.
```

Готовые файлы — в `public/city/` (или пришлите сюда). Прототип сам подхватит стадии: пока картинки стадии нет,
здание показывается «проступающим» с нарисованными лесами.
