import type { ShellProjection } from "@agent-cli-contact/contracts";
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
    const herdr = projection?.herdr;
    return (
        <div className="statusbar">
            {connected ? (
                <span className="g">● {t("sb.connected")}</span>
            ) : (
                <span className="r">○ {t("sb.disconnected")}</span>
            )}
            <span>
                {herdr?.status === "ready" ? `herdr v${herdr.version ?? "?"} · unix socket` : "…"}
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
