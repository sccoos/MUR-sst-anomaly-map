# MUR SST anomaly map

An Observable Framework site with a full-card MapLibre view for animating MUR sea-surface-temperature anomaly PNG rasters.

## Frame archive

The generator is self-contained in Observable’s ZIP loader at `src/data/pices_anomaly_frames.zip.py`; `npm run dev` and `npm run build` invoke it automatically.

It discovers every `noaxis_Anomaly_sst_YYYYMMDD.png` available in the [CENCOOS anomaly-map directory](https://cencoos.org/images/PICES/anomaly_maps/) and uses a PyProj/SciPy coordinate resample to reproject each from its geographic (`EPSG:4326`) pixel grid to Web Mercator (`EPSG:3857`) before writing the ZIP archive.

The ZIP contains a `manifest.json` and chronologically ordered frames. The page references that single archive through a literal Observable `FileAttachment`, then unpacks it in the browser. This keeps the map UI independent of the number of available dates. Map corners remain northwest `[-129, 42]`, northeast `[-117, 42]`, southeast `[-117, 32]`, southwest `[-129, 32]`.

`src/data/maplibre-gl-csp-worker.js` and `src/data/maplibre-gl.css` are locally bundled MapLibre assets. Keep them alongside the site so preview and GitHub Pages never attempt to resolve a `file:///` worker URL or fetch framework styling from a CDN.

## Run and deploy

Run `npm install`, then `npm run dev`. The GitHub Actions workflow regenerates the frame archive, builds `dist`, and publishes it to GitHub Pages on pushes to `main`. In the repository’s **Settings → Pages**, select **GitHub Actions** as the build and deployment source.

The configured page base is `/MUR-sst-anomaly-map/`; change `base` in `observablehq.config.js` if the repository is renamed.
