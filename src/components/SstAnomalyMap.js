// Bare imports keep builds reproducible from package-lock.json; Observable resolves them
// from node_modules rather than requesting the npm registry at build time.
import {createElement, useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import JSZip from "jszip";
// MapLibre publishes a CommonJS-compatible default export. Observable's module
// loader preserves that default rather than promoting its properties to named exports.
import maplibregl from "maplibre-gl";

const BOUNDS = [[-129, 32], [-117, 42]];
const BASEMAP_STYLE_URL = "https://tiles.openfreemap.org/styles/positron";
const FRAME_PATH = /^frames\/(\d{4})-?(\d{2})-?(\d{2})\.png$/;
const COLORBAR_TICKS = [7, 5, 3, 1, 0, -1, -3];

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"}).format(new Date(`${date}T00:00:00Z`));
}

function formatColorbarTick(value) {
  return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : "0";
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
        if (!frameFiles.length) throw new Error("Frame archive does not contain dated PNG frames");

        const orderedFrames = await Promise.all(frameFiles.map(async ({date, file}) => {
          const url = URL.createObjectURL(await file.async("blob"));
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
      fitBoundsOptions: {padding: 22, maxZoom: 6.4},
      attributionControl: false
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({showCompass: false}), "top-right");
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
    const next = () => {
      setFrameIndex((current) => (current + 1) % frames.length);
      animationRef.current = window.setTimeout(next, 200);
    };
    animationRef.current = window.setTimeout(next, 200);
    return () => window.clearTimeout(animationRef.current);
  }, [frames.length, isPlaying]);

  return createElement("section", {className: "sst-card", "aria-label": "Sea-surface temperature anomaly map"},
    createElement("div", {ref: mapContainerRef, className: "sst-card__map", role: "img", "aria-label": activeFrame ? `Sea-surface temperature anomaly map for ${formatDate(activeFrame.date)}` : "Sea-surface temperature anomaly map"}),
    isLoadingFrames && createElement("div", {className: "sst-frame-loading", role: "status", "aria-label": "Loading map frames"},
      createElement("span", {className: "sst-frame-loading__spinner", "aria-hidden": "true"})
    ),
    createElement("aside", {className: "sst-colorbar", "aria-label": "Sea-surface temperature anomaly color scale from minus 3 to plus 7 degrees Celsius, with zero shown as white"},
      createElement("span", {className: "sst-colorbar__unit", "aria-hidden": "true"}, "°C"),
      createElement("div", {className: "sst-colorbar__scale"}),
      createElement("div", {className: "sst-colorbar__ticks", "aria-hidden": "true"},
        COLORBAR_TICKS.map((value) => createElement("span", {key: value, style: {top: `${(7 - value) * 10}%`}}, formatColorbarTick(value)))
      )
    ),
    createElement("div", {className: `sst-time-control${isPlaying ? " sst-time-control--playing" : ""}`},
      createElement("button", {type: "button", className: "sst-play", onClick: () => setIsPlaying((playing) => !playing), disabled: frames.length < 2, "aria-label": isPlaying ? "Pause animation" : "Play animation", "aria-pressed": isPlaying}, isPlaying ? "❚❚" : "▶"),
      createElement("span", {className: "sst-slider-date"}, activeFrame ? formatDate(activeFrame.date) : frameLoadError ? "Frame archive unavailable" : "Loading frames…"),
      createElement("input", {className: "sst-slider", type: "range", min: 0, max: Math.max(frames.length - 1, 0), value: frameIndex, onChange: (event) => setFrameIndex(Number(event.target.value)), disabled: frames.length < 2, "aria-label": "Select map date"})
    )
  );
}

export function renderSstAnomalyMap(props) {
  const container = document.createElement("div");
  const root = createRoot(container);
  root.render(createElement(SstAnomalyMap, props));
  return container;
}
