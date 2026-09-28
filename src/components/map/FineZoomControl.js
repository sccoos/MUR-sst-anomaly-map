import {ZOOM_STEP} from "./mapConfig.js";

export class FineZoomControl {
  onAdd(map) {
    this.map = map;
    this.container = document.createElement("div");
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group sst-fine-zoom";

    const addButton = (symbol, label, delta) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = symbol;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", () => {
        const nextZoom = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + delta));
        map.easeTo({zoom: nextZoom, duration: 180});
      });
      this.container.append(button);
    };

    addButton("+", "Zoom in", ZOOM_STEP);
    addButton("−", "Zoom out", -ZOOM_STEP);
    return this.container;
  }

  onRemove() {
    this.container.remove();
    this.map = undefined;
  }
}
