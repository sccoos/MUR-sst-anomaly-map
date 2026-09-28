import {createElement} from "react";

export function LoadingSpinner({label = "Loading"}) {
  return createElement("div", {className: "loading-spinner", role: "status", "aria-label": label},
    createElement("span", {className: "loading-spinner__indicator", "aria-hidden": "true"})
  );
}
