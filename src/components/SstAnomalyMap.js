// Bare imports keep builds reproducible from package-lock.json; Observable resolves them
// from node_modules rather than requesting the npm registry at build time.
import {createElement, useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import JSZip from "jszip";
import {Colorbar} from "./Colorbar.js";
import {PlaybackControl} from "./PlaybackControl.js";
// MapLibre publishes a CommonJS-compatible default export. Observable's module
// loader preserves that default rather than promoting its properties to named exports.
import maplibregl from "maplibre-gl";

const BOUNDS = [[-129, 32], [-117, 42]];
const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const FRAME_PATH = /^frames\/(\d{4})-?(\d{2})-?(\d{2})\.webp$/;
const ZOOM_STEP = 0.5;
const PLAYBACK_INTERVAL_MS = 300;

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"}).format(new Date(`${date}T00:00:00Z`));
}

class FineZoomControl {
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

function SstAnomalyMap({frameArchive, workerUrl}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const animationRef = useRef(null);
  const [frames, setFrames] = useState([]);
  const [frameLoadError, setFrameLoadError] = useState(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const activeFrame = frames[frameIndex];
  const isLoadingFrames = !activeFrame && !frameLoadError;

  useEffect(() => {
    let cancelled = false;
    const frameUrls = [];

    const loadFrames = async () => {
      try {
        const archive = await JSZip.loadAsync(await frameArchive);
        // The archive contents, rather than a fixed date list, define the slider.
        // This lets the loader add or remove PNGs without requiring UI changes.
        const frameFiles = Object.values(archive.files)
          .flatMap((file) => {
            const match = FRAME_PATH.exec(file.name);
            return !file.dir && match ? [{date: `${match[1]}-${match[2]}-${match[3]}`, file}] : [];
          })
          .sort((left, right) => left.date.localeCompare(right.date));
        if (!frameFiles.length) throw new Error("Frame archive does not contain dated WebP frames");

        const orderedFrames = await Promise.all(frameFiles.map(async ({date, file}) => {
          const webp = new Blob([await file.async("uint8array")], {type: "image/webp"});
          const url = URL.createObjectURL(webp);
          frameUrls.push(url);
          return {date, url};
        }));
        if (cancelled) return;
        setFrames(orderedFrames);
        setFrameLoadError(null);
      } catch (error) {
        if (!cancelled) setFrameLoadError(error.message ?? "Unable to load the frame archive");
      }
    };
    loadFrames();

    return () => {
      cancelled = true;
      for (const url of frameUrls) URL.revokeObjectURL(url);
    };
  }, [frameArchive]);

  useEffect(() => {
    if (frameIndex >= frames.length) setFrameIndex(0);
  }, [frameIndex, frames.length]);

  useEffect(() => {
    if (!mapContainerRef.current) return undefined;

    // Observable bundles this worker as an HTTP asset. This prevents MapLibre's
    // default worker resolution from attempting to load a local file URL.
    maplibregl.setWorkerUrl(workerUrl);
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: BASEMAP_STYLE_URL,
      bounds: BOUNDS,
      fitBoundsOptions: {padding: 0},
      zoomSnap: ZOOM_STEP,
      attributionControl: false
    });
    mapRef.current = map;
    map.addControl(new FineZoomControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({compact: true}), "bottom-right");
    map.once("load", () => {
      // MapLibre can auto-expand compact attribution at wide viewport sizes.
      // Start as the info button; the user can still expand it on demand.
      map.getContainer()
        .querySelector(".maplibregl-ctrl-attrib")
        ?.classList.remove("maplibregl-compact-show");
      setMapReady(true);
    });

    const resizeObserver = new ResizeObserver(() => map.resize());
    resizeObserver.observe(mapContainerRef.current);
    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [workerUrl]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !activeFrame) return undefined;
    const sourceId = "sst-anomaly-frame";
    const layerId = "sst-anomaly-raster";
    const updateFrame = () => {
      const existing = map.getSource(sourceId);
      if (existing) existing.updateImage({url: activeFrame.url, coordinates: [[-129, 42], [-117, 42], [-117, 32], [-129, 32]]});
      else {
        map.addSource(sourceId, {type: "image", url: activeFrame.url, coordinates: [[-129, 42], [-117, 42], [-117, 32], [-129, 32]]});
        const firstTextLayerId = map.getStyle().layers
          ?.find((layer) => layer.type === "symbol" && layer.layout?.["text-field"])
          ?.id;
        map.addLayer(
          {id: layerId, type: "raster", source: sourceId, paint: {"raster-opacity": 1}},
          firstTextLayerId
        );
      }
    };
    updateFrame();
  }, [activeFrame, mapReady]);

  useEffect(() => {
    if (!isPlaying || frames.length < 2) return undefined;
    let lastFrameTime = null;
    const next = (timestamp) => {
      if (lastFrameTime === null) lastFrameTime = timestamp;
      if (timestamp - lastFrameTime >= PLAYBACK_INTERVAL_MS) {
        setFrameIndex((current) => (current + 1) % frames.length);
        lastFrameTime = timestamp;
      }
      animationRef.current = window.requestAnimationFrame(next);
    };
    animationRef.current = window.requestAnimationFrame(next);
    return () => window.cancelAnimationFrame(animationRef.current);
  }, [frames.length, isPlaying]);

  return createElement("section", {className: "sst-card", "aria-label": "Sea-surface temperature anomaly map"},
    createElement("div", {ref: mapContainerRef, className: "sst-card__map", role: "img", "aria-label": activeFrame ? `Sea-surface temperature anomaly map for ${formatDate(activeFrame.date)}` : "Sea-surface temperature anomaly map"}),
    isLoadingFrames && createElement("div", {className: "sst-frame-loading", role: "status", "aria-label": "Loading map frames"},
      createElement("span", {className: "sst-frame-loading__spinner", "aria-hidden": "true"})
    ),
    createElement(Colorbar),
    createElement(PlaybackControl, {
      activeFrame,
      frameLoadError,
      frameIndex,
      frameCount: frames.length,
      isPlaying,
      onFrameIndexChange: (index) => {
        setIsPlaying(false);
        setFrameIndex(index);
      },
      onTogglePlayback: () => setIsPlaying((playing) => !playing)
    })
  );
}

export function renderSstAnomalyMap(props) {
  const container = document.createElement("div");
  const root = createRoot(container);
  root.render(createElement(SstAnomalyMap, props));
  return container;
}
