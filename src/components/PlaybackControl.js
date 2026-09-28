import {createElement} from "react";

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"}).format(new Date(`${date}T00:00:00Z`));
}

export function PlaybackControl({activeFrame, frameLoadError, frameIndex, frameCount, isPlaying, onFrameIndexChange, onTogglePlayback}) {
  return createElement("div", {className: `sst-time-control${isPlaying ? " sst-time-control--playing" : ""}`},
    createElement("button", {type: "button", className: "sst-play", onClick: onTogglePlayback, disabled: frameCount < 2, "aria-label": isPlaying ? "Pause animation" : "Play animation", "aria-pressed": isPlaying}, isPlaying ? "❚❚" : "▶"),
    createElement("span", {className: "sst-slider-date"}, activeFrame ? `Daily SST Anomaly from MUR: ${formatDate(activeFrame.date)}` : frameLoadError ? "Frame archive unavailable" : "Loading frames…"),
    createElement("input", {className: "sst-slider", type: "range", min: 0, max: Math.max(frameCount - 1, 0), value: frameIndex, onChange: (event) => onFrameIndexChange(Number(event.target.value)), disabled: frameCount < 2, "aria-label": "Select map date"})
  );
}
