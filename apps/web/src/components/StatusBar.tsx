import type { ShellProjection } from "@workbench/contracts";
import { useI18n } from "../i18n";

export function StatusBar({
    projection,
    connected,
}: {
    projection: ShellProjection | null;
    connected: boolean;
}) {
    const { t } = useI18n();
    const agents = projection?.agents ?? [];
    const blocked = agents.filter((a) => a.status === "blocked").length;
    const runtime = projection?.runtime;
    return (
        <div className="statusbar">
            {connected ? (
                <span className="g">● {t("sb.connected")}</span>
            ) : (
                <span className="r">○ {t("sb.disconnected")}</span>
            )}
            <span>
                {runtime
                    ? runtime.mode === "herdr"
                        ? `herdr v${runtime.herdrVersion ?? "?"} · unix socket`
                        : t("sb.mock")
                    : "…"}
            </span>
            <span>{t("sb.agents", { n: agents.length, m: blocked })}</span>
            <span className="ml">
                {t("sb.relay", {
                    state: projection?.mesh.relayApproval ? t("sb.on") : t("sb.off"),
                })}
            </span>
        </div>
    );
}
