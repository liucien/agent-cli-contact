import type { ShellProjection } from "@agent-cli-contact/contracts";
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
    return (
        <div className="titlebar">
            <div className="title">
                agent-cli-contact
                {ws ? ` — ${ws.label}` : ""}
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
