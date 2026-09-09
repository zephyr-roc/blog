import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "data/deep-radar-hardware-prices-cn.json");
const data = JSON.parse(await readFile(dataPath, "utf8"));
const latestDate = data.series
  .flatMap((series) => series.observations.map((item) => item.date))
  .sort()
  .at(-1);
const outputPath = path.join(root, `public/deep-radar/${latestDate}-cn-hardware-prices.svg`);

const width = 1200;
const height = 760;
const panelWidth = 370;
const panelHeight = 285;
const gapX = 30;
const gapY = 34;
const originX = 30;
const originY = 108;
const end = Date.parse(`${latestDate}T00:00:00Z`);
const start = end - 29 * 24 * 60 * 60 * 1000;
const startDate = new Date(start).toISOString().slice(0, 10);
const colors = ["#7dd3fc", "#c4b5fd", "#86efac", "#f9a8d4", "#fcd34d", "#fdba74"];

const esc = (value) => String(value).replace(/[&<>\"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"
}[char]));
const plotLeft = (x) => x + 34;
const plotRight = (x) => x + panelWidth - 34;
const dateX = (date, x) => plotLeft(x) + ((Date.parse(`${date}T00:00:00Z`) - start) / (end - start)) * (plotRight(x) - plotLeft(x));
const money = (price) => `¥${Number.isInteger(price) ? price : price.toFixed(2)}`;

const selectLabels = (points) => {
  const candidates = points.filter((point, index) =>
    index === 0 || index === points.length - 1 || point.price !== points[index - 1].price
  );
  const selected = [];
  for (const point of candidates) {
    const previous = selected.at(-1);
    if (!previous || point.x - previous.x >= 64) {
      selected.push(point);
    } else if (point === points.at(-1)) {
      selected[selected.length - 1] = point;
    }
  }
  if (selected[0] !== points[0]) selected.unshift(points[0]);
  return new Set(selected);
};

const panels = data.series.map((series, index) => {
  const col = index % 3;
  const row = Math.floor(index / 3);
  const x = originX + col * (panelWidth + gapX);
  const y = originY + row * (panelHeight + gapY);
  const observations = series.observations.filter((item) => {
    const timestamp = Date.parse(`${item.date}T00:00:00Z`);
    return timestamp >= start && timestamp <= end;
  });
  const prices = observations.map((item) => item.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const padding = Math.max((max - min) * 0.28, Math.max(max * 0.025, 12));
  const low = min - padding;
  const high = max + padding;
  const priceY = (price) => y + 92 + ((high - price) / (high - low)) * 112;
  const points = observations.map((item) => ({
    ...item,
    x: dateX(item.date, x),
    y: priceY(item.price)
  }));
  const line = points.length > 1
    ? `<polyline points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")}" fill="none" stroke="${colors[index]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
    : "";
  const circles = points.map((point) =>
    `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="4" fill="${colors[index]}"/>`
  ).join("");
  const labels = selectLabels(points);
  const marks = points.map((point, pointIndex) => {
    if (!labels.has(point)) return "";
    const anchor = point.x > x + panelWidth - 84 ? "end" : "start";
    const labelX = point.x + (anchor === "end" ? -7 : 7);
    const valueY = Math.max(y + 82, Math.min(y + 201, point.y - 10));
    const dateLabel = point.date.slice(5).replace("-", "/");
    const showValue = pointIndex === points.length - 1 || !points.slice(pointIndex + 1).some((later) => later.price === point.price);
    return `${showValue ? `<text x="${labelX.toFixed(1)}" y="${valueY.toFixed(1)}" text-anchor="${anchor}" class="value">${money(point.price)}</text>` : ""}
      <text x="${point.x.toFixed(1)}" y="${y + 237}" text-anchor="end" transform="rotate(-38 ${point.x.toFixed(1)} ${y + 237})" class="date">${dateLabel}</text>
      ${pointIndex === points.length - 1 ? `<text x="${x + 24}" y="${y + 264}" class="kind">最新：${esc(point.kind)} · ${esc(point.merchant)}</text>` : ""}`;
  }).join("\n");
  return `<g>
    <rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="24" class="panel"/>
    <text x="${x + 24}" y="${y + 34}" class="category">${esc(series.category)}</text>
    <text x="${x + 24}" y="${y + 60}" class="product">${esc(series.product)}</text>
    <line x1="${x + 24}" y1="${y + 214}" x2="${x + panelWidth - 24}" y2="${y + 214}" class="axis"/>
    <g clip-path="url(#plot-${index})">${line}${circles}</g>
    ${marks}
    ${points.length === 1 ? `<text x="${x + panelWidth - 24}" y="${y + 34}" text-anchor="end" class="sparse">仅 1 个真实点</text>` : ""}
  </g>`;
}).join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">中国大陆六类 PC 硬件公开价格事件</title>
  <desc id="desc">${startDate} 至 ${latestDate} CPU、GPU、主板、DRAM、HDD 与 SSD 的可复核报价。只连接真实日期点，单点品类不生成趋势线。</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#07101f"/><stop offset="1" stop-color="#130d24"/></linearGradient>
    ${data.series.map((_, index) => {
      const x = originX + (index % 3) * (panelWidth + gapX);
      const y = originY + Math.floor(index / 3) * (panelHeight + gapY);
      return `<clipPath id="plot-${index}"><rect x="${plotLeft(x) - 6}" y="${y + 76}" width="${plotRight(x) - plotLeft(x) + 12}" height="136"/></clipPath>`;
    }).join("\n")}
  </defs>
  <style>
    text{font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
    .title{fill:#f8fafc;font-size:28px;font-weight:700}.subtitle{fill:#94a3b8;font-size:14px}
    .panel{fill:#ffffff0a;stroke:#ffffff1f}.category{fill:#f8fafc;font-size:20px;font-weight:700}
    .product{fill:#a7b2c5;font-size:12px}.axis{stroke:#ffffff24}.value{fill:#f8fafc;font-size:12px;font-weight:650}
    .date{fill:#8290a7;font-size:10px}.kind{fill:#8290a7;font-size:10px}.sparse{fill:#fbbf24;font-size:10px}
  </style>
  <rect width="${width}" height="${height}" rx="32" fill="url(#bg)"/>
  <text x="30" y="45" class="title">中国大陆 PC 硬件价格观察</text>
  <text x="30" y="75" class="subtitle">${startDate}—${latestDate} · 公开可复核价格事件 · 单位：人民币 · 不插值</text>
  ${panels}
  <text x="30" y="739" class="subtitle">数据由 data/deep-radar-hardware-prices-cn.json 生成；单点表示当前公开样本不足以判断趋势。</text>
</svg>\n`;

await writeFile(outputPath, svg, "utf8");
console.log(outputPath);
