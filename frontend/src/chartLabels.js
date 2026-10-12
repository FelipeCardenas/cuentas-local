import { money } from "./domain.js";
import { barGroups } from "./chartData.js";

export const barValueLabels = {
  id: "barValueLabels",
  afterDatasetsDraw(chart) {
    if (chart.config.type !== "bar") return;
    const horizontal = chart.options.indexAxis === "y";
    const {ctx, data} = chart;
    ctx.save();
    ctx.font = "600 11px sans-serif";
    for (const group of barGroups(data.datasets)) {
      for (let index = 0; index < data.labels.length; index++) {
        const parts = group.filter((i) => chart.isDatasetVisible(i) && data.datasets[i].data[index] != null)
          .map((i) => ({value: Number(data.datasets[i].data[index]), bar: chart.getDatasetMeta(i).data[index]}))
          .filter((p) => p.bar && !p.bar.skip);
        if (!parts.length) continue;
        const total = parts.reduce((sum, p) => sum + p.value, 0);
        const mixed = parts.some((p) => p.value < 0) && parts.some((p) => p.value > 0);
        const text = `${mixed ? "Neto " : ""}${money(total)}`;
        const positive = mixed || total >= 0;
        const end = horizontal
          ? Math.max(...parts.flatMap((p) => [p.bar.x, p.bar.base]))
          : (positive ? Math.min(...parts.map((p) => p.bar.y)) : Math.max(...parts.map((p) => p.bar.y)));
        ctx.fillStyle = chart.options.color || "#263c37";
        ctx.textAlign = horizontal ? "left" : "center";
        ctx.textBaseline = horizontal ? "middle" : (positive ? "bottom" : "top");
        if (!horizontal && parts[0].bar.width < ctx.measureText(text).width + 8) {
          ctx.save();
          ctx.translate(parts[0].bar.x, end + (positive ? -6 : 6));
          ctx.rotate(-Math.PI / 3);
          ctx.textAlign = positive ? "left" : "right";
          ctx.textBaseline = "middle";
          ctx.fillText(text, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(text, horizontal ? end + 6 : parts[0].bar.x,
            horizontal ? parts[0].bar.y : end + (positive ? -6 : 6));
        }
        if (parts.length < 2) continue;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (const {value, bar} of parts) {
          if (!value) continue;
          const label = money(value);
          const width = horizontal ? Math.abs(bar.x - bar.base) : bar.width;
          const height = horizontal ? bar.height : Math.abs(bar.y - bar.base);
          if (height < 19 || width < ctx.measureText(label).width + 8) continue;
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, horizontal ? (bar.x + bar.base) / 2 : bar.x,
            horizontal ? bar.y : (bar.y + bar.base) / 2);
        }
      }
    }
    ctx.restore();
  },
};
