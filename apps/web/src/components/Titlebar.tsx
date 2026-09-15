import type { ShellProjection } from "@workbench/contracts";
import { openSettings, type Screen } from "../store";
import { useI18n } from "../i18n";

export function Titlebar({
    projection,
    selectedWorkspaceId,
    screen,
}: {
    projection: ShellProjection | null;
    selectedWorkspaceId: string | null;
    screen: Screen;
}) {
    const { t, locale, setLocale } = useI18n();
    const ws = projection?.workspaces.find((w) => w.id === selectedWorkspaceId);
    const label = ws ? ws.label : "…";
    return (
        <div className="titlebar">
            <div className="dots">
                <div className="dot" style={{ background: "#ff5f57" }} />
                <div className="dot" style={{ background: "#febc2e" }} />
                <div className="dot" style={{ background: "#28c840" }} />
            </div>
            <div className="title">
                agent-cli-contact — {label}
                {screen === "mesh" ? " · Agent Mesh" : ""}
            </div>
            <div className="right">
                <button
                    className="chip"
                    title="中文 / English"
                    onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
                >
                    {locale === "zh" ? "EN" : "中"}
                </button>
                <span className="chip">{t("titlebar.commands")}</span>
                <button className="chip" title={t("set.title")} onClick={openSettings}>
                    ⚙︎
                </button>
            </div>
        </div>
    );
}
