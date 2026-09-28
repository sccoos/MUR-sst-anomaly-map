---
title: MUR sea-surface temperature anomaly
toc: false
---

```js
import {renderSstAnomalyMap} from "./components/map/SstAnomalyMap.js";

// A literal attachment lets Observable bundle the generated archive for local
// preview and GitHub Pages, regardless of the number of frames inside it.
// Pass the attachment promise through so the map can initialize while the
// comparatively large archive downloads and expands in the component.
const frameArchive = FileAttachment("data/pices_anomaly_frames.zip").arrayBuffer();
const workerUrl = await FileAttachment("assets/maplibre/maplibre-gl-csp-worker.js").url();
display(renderSstAnomalyMap({frameArchive, workerUrl}));
```
