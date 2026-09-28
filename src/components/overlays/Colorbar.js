import {createElement} from "react";

const COLORBAR_TICKS = [7, 3, 0, -3];

function formatColorbarTick(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0°C";
}

export function Colorbar() {
  return createElement("aside", {className: "sst-colorbar", "aria-label": "Sea-surface temperature anomaly color scale from minus 3 to plus 7 degrees Celsius, with zero shown as white"},
    createElement("div", {className: "sst-colorbar__scale"}),
    createElement("div", {className: "sst-colorbar__ticks", "aria-hidden": "true"},
      COLORBAR_TICKS.map((value) => createElement("span", {key: value, style: {top: `${(7 - value) * 10}%`}}, formatColorbarTick(value)))
    )
  );
}
