import { useState } from "react";
import type { SettingsUpdateParams, ShellProjection } from "@agent-cli-contact/contracts";
import { call, closeSettings } from "../store";
import { useI18n } from "../i18n";

/** 全局设置弹层（目前只有编辑器命令一项） */
export function SettingsPopover({ projection }: { projection: ShellProjection }) {
    const { t } = useI18n();
    const [editorCommand, setEditorCommand] = useState(projection.settings.editorCommand);

    const save = () => {
        const params: SettingsUpdateParams = { editorCommand: editorCommand.trim() || "code" };
        void call("settings.update", params).then(closeSettings, () => undefined);
    };

    return (
        <>
            <div className="scrim" onClick={closeSettings} />
            <div className="pop settings-pop" role="dialog" aria-modal="true">
                <div className="hd">
                    <b>{t("set.title")}</b>
                </div>
                <label className="set-field">
                    <span className="set-lb">{t("set.editorCommand")}</span>
                    <input
                        type="text"
                        value={editorCommand}
                        placeholder="code"
                        autoFocus
                        onChange={(e) => setEditorCommand(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") save();
                        }}
                    />
                </label>
                <div className="note">{t("set.editorCaption")}</div>
                <div className="set-actions">
                    <button className="btn" onClick={closeSettings}>
                        {t("btn.cancel")}
                    </button>
                    <button className="btn pri" onClick={save}>
                        {t("set.save")}
                    </button>
                </div>
            </div>
        </>
    );
}
