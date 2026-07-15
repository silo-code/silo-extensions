import { useStore } from "../hooks";
import { getDescriptor } from "../registry";
import { openAllProcessesModal } from "./AllProcessesModal";

// Single registered status item that renders chips in the configured order.
// display:contents makes the wrapper invisible to layout so each chip
// participates directly as a flex child of the status bar — spacing and
// alignment match native items exactly. (Clicks still bubble through a
// display:contents element, so the modal-open handler lives here rather
// than on each chip.)
export function SystemMonitorStatus() {
  const store = useStore();
  const enabled = store.settings.statusBar.filter((item) => item.enabled);
  if (enabled.length === 0) return null;

  const { live } = store;

  return (
    <div
      style={{ display: "contents" }}
      onClick={() => void openAllProcessesModal()}
    >
      {enabled.map((item) => {
        const descriptor = getDescriptor(item.id);
        if (!descriptor?.StatusComponent) return null;
        const { StatusComponent } = descriptor;
        return <StatusComponent key={item.id} live={live} />;
      })}
    </div>
  );
}
