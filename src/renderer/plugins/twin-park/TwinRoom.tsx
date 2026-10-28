/***
 * Twin Studio as a first-level workspace room: the twin-park plugin's project panel, hosted in the
 * same sandboxed frame the Plugins page uses, reached from its own sidebar row. The plugin must be
 * installed and active for the panel to load; otherwise a plain notice says so.
 */
import type { JSX } from "react";
import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n.ts";
import type { PluginInfo, PluginPanelDocument } from "../../../shared/plugins.ts";
import { usePlugins } from "../../state/hooks.ts";
import { PluginPanelHost } from "../../panels/PluginPanelHost.tsx";
import { isActive } from "../../panels/plugins/labels.ts";
import { PanelSurface } from "../../panels/panel-bridge.ts";
import { IconButton } from "../../ui/kit.tsx";

const TWIN_PLUGIN_ID = "twin-park";
const TWIN_PANEL_ID = "twin-workspace";
/** The room name `data-room` carries while Twin Studio covers the workspace. */
export const TWIN_ROOM = "twin";

/** The loaded panel, or the state while it loads or when the plugin is unavailable. */
type TwinPanel = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; document: PluginPanelDocument };

/** The twin-park plugin once it is installed and active, or undefined. */
function useTwinPlugin(): PluginInfo | undefined {
  return usePlugins((state) => state.list.find((p) => p.manifest.id === TWIN_PLUGIN_ID && isActive(p)));
}

function useTwinDocument(plugin: PluginInfo | undefined): TwinPanel {
  const [panel, setPanel] = useState<TwinPanel>({ kind: "loading" });
  useEffect(() => {
    let disposed = false;
    if (!plugin) {
      setPanel({ kind: "missing" });
      return;
    }
    setPanel({ kind: "loading" });
    void window.studio
      .pluginPanel(TWIN_PLUGIN_ID, TWIN_PANEL_ID)
      .then((document) => {
        if (!disposed) setPanel({ kind: "ready", document });
      })
      .catch(() => {
        if (!disposed) setPanel({ kind: "missing" });
      });
    return () => {
      disposed = true;
    };
  }, [plugin]);
  return panel;
}

/** Twin Studio over the workspace: the twin-park project panel, or a notice when unavailable. */
export function TwinRoom({
  project,
  sidebarHidden,
  onToggleSidebar,
  onBack,
}: {
  project: string | null;
  sidebarHidden: boolean;
  onToggleSidebar: () => void;
  onBack: () => void;
}): JSX.Element {
  const plugin = useTwinPlugin();
  const panel = useTwinDocument(plugin);
  return (
    <section className="twin-room h-full" data-room={TWIN_ROOM} aria-label={t("Twin Studio")}>
      <div className="studio-room-header">
        <button type="button" className="studio-room-back" aria-label={t("Back")} onClick={onBack}>
          {t("Twin Studio")}
        </button>
        {sidebarHidden && <IconButton icon="sidebar" label={t("Toggle sidebar")} onClick={onToggleSidebar} />}
      </div>
      <div className="twin-room-body">
        {panel.kind === "ready" ? (
          <PluginPanelHost
            plugin={plugin as PluginInfo}
            document={panel.document}
            project={project}
            surface={PanelSurface.Page}
            className="extension-frame"
          />
        ) : (
          <p className="twin-room-empty">
            {panel.kind === "missing"
              ? t("Twin Studio 插件未启用，请先安装并启用 twin-park 插件。")
              : t("正在加载 Twin Studio…")}
          </p>
        )}
      </div>
    </section>
  );
}
