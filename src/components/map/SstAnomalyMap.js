// Bare imports keep builds reproducible from package-lock.json; Observable resolves them
// from node_modules rather than requesting the npm registry at build time.
import {createElement, useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import JSZip from "jszip";
import {Colorbar} from "../overlays/Colorbar.js";
import {LoadingSpinner} from "../overlays/LoadingSpinner.js";
import {PlaybackControl} from "../overlays/PlaybackControl.js";
import {formatDate} from "../../utils/formatDate.js";
import {FineZoomControl} from "./FineZoomControl.js";
import {BASEMAP_STYLE_URL, FRAME_PATH, MAP_BOUNDS, MAP_IMAGE_COORDINATES, PLAYBACK_INTERVAL_MS, ZOOM_STEP} from "./mapConfig.js";
// MapLibre publishes a CommonJS-compatible default export. Observable's module
// loader preserves that default rather than promoting its properties to named exports.
import maplibregl from "maplibre-gl";

function fitRasterVertically(map) {
  // Start by centering the raster bounds, then increase the zoom just enough
  // for its north and south edges to meet the map's top and bottom edges.
  // fitBounds alone can leave vertical space on a narrow viewport because it
  // must keep the entire raster width visible as well.
  map.fitBounds(MAP_BOUNDS, {padding: 0, duration: 0});
  const south = map.project(MAP_BOUNDS[0]);
  const north = map.project(MAP_BOUNDS[1]);
  const rasterHeight = Math.abs(south.y - north.y);
  const mapHeight = map.getContainer().clientHeight;

  if (rasterHeight > 0 && mapHeight > 0) {
    map.zoomTo(map.getZoom() + Math.log2(mapHeight / rasterHeight), {duration: 0});
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
        setFrameIndex(orderedFrames.length - 1);
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
      bounds: MAP_BOUNDS,
      fitBoundsOptions: {padding: 0},
      zoomSnap: ZOOM_STEP,
      attributionControl: false
    });
    mapRef.current = map;
    map.addControl(new FineZoomControl(), "top-right");
    map.addControl(new maplibregl.AttributionControl({compact: true}), "bottom-right");
    map.once("load", () => {
      fitRasterVertically(map);
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
      if (existing) existing.updateImage({url: activeFrame.url, coordinates: MAP_IMAGE_COORDINATES});
      else {
        map.addSource(sourceId, {type: "image", url: activeFrame.url, coordinates: MAP_IMAGE_COORDINATES});
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
    isLoadingFrames && createElement(LoadingSpinner, {label: "Loading map frames"}),
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
