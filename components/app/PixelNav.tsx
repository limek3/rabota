/**
 * Пункт меню «Холст» — чтобы бросался в глаза: жирная пиксельная надпись с объёмной тенью,
 * по ней плывёт радужный градиент и вспыхивают искры; иконка — мерцающая сетка 3×3.
 * Цвета и анимация — app/canvas.css (.pxn-*); при «уменьшить движение» всё стоит на месте.
 */

// буквы 6×7, штрихи в два пикселя: '#' — закрашенный пиксель
const GLYPHS: Record<string, string[]> = {
  Х: ["##..##", "##..##", ".####.", "..##..", ".####.", "##..##", "##..##"],
  О: [".####.", "##..##", "##..##", "##..##", "##..##", "##..##", ".####."],
  Л: ["..####", ".##.##", ".##.##", ".##.##", ".##.##", ".##.##", "##..##"],
  С: [".####.", "##..##", "##....", "##....", "##....", "##..##", ".####."],
  Т: ["######", "######", "..##..", "..##..", "..##..", "..##..", "..##.."],
};
const GW = 6;
const GAP = 1;

// искры: клетка надписи и задержка — вспыхивают по очереди в разных буквах
const SPARKS: [number, number, number][] = [
  [1, 0, 0],
  [13, 6, 0.9],
  [22, 1, 1.7],
  [32, 0, 2.5],
  [8, 3, 3.3],
];

export function PixelWord({ text = "ХОЛСТ", height = 14 }: { text?: string; height?: number }) {
  const letters = Array.from(text.toUpperCase()).filter((ch) => GLYPHS[ch]);
  const w = letters.length * (GW + GAP) - GAP;
  const cells: string[] = [];
  letters.forEach((ch, i) =>
    GLYPHS[ch].forEach((row, y) =>
      Array.from(row).forEach((c, x) => {
        if (c === "#") cells.push(`M${i * (GW + GAP) + x} ${y}h1v1h-1z`);
      }),
    ),
  );
  const d = cells.join("");
  // +1 по ширине и высоте — место под тень
  return (
    <svg className="pxn-word" viewBox={`0 0 ${w + 1} 8`} height={height} width={(height * (w + 1)) / 8} role="img" aria-label={text} shapeRendering="crispEdges">
      <defs>
        <linearGradient id="pxn-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w * 2} y2="0" spreadMethod="repeat">
          <stop offset="0" stopColor="#ff5d8f" />
          <stop offset="0.2" stopColor="#ffb547" />
          <stop offset="0.4" stopColor="#5ee7a0" />
          <stop offset="0.6" stopColor="#4cc9ff" />
          <stop offset="0.8" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#ff5d8f" />
          <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to={`${-w * 2} 0`} dur="5s" repeatCount="indefinite" />
        </linearGradient>
      </defs>
      <path className="pxn-shadow" d={d} transform="translate(1 1)" />
      <path d={d} fill="url(#pxn-grad)" />
      {SPARKS.filter(([x]) => x < w).map(([x, y, delay]) => (
        <rect key={`${x}-${y}`} className="pxn-spark" x={x} y={y} width={1} height={1} style={{ animationDelay: `${delay}s` }} />
      ))}
    </svg>
  );
}

// порядок вспышек в иконке — вразнобой, чтобы сетка «искрила»
const SPARK = [0, 5, 2, 7, 4, 1, 8, 3, 6];

export function PixelIcon({ size = 16 }: { size?: number }) {
  return (
    <span className="pxn-ic" style={{ width: size, height: size }} aria-hidden>
      {SPARK.map((d, i) => (
        <i key={i} style={{ animationDelay: `${-d * 0.33}s` }} />
      ))}
    </span>
  );
}
