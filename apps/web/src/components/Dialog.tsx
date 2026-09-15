import { useEffect, useRef, useState } from "react";
import { resolveDialog, type DialogState } from "../store";
import { useI18n } from "../i18n";

/** 应用内 prompt/confirm 模态框（WKWebView 不支持原生 window.prompt/confirm） */
export function Dialog({ dialog }: { dialog: DialogState }) {
    const { t } = useI18n();
    const [value, setValue] = useState(dialog.kind === "prompt" ? (dialog.defaultValue ?? "") : "");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
    }, []);

    const cancel = () => resolveDialog(null);
    const ok = () => {
        if (dialog.kind === "prompt") {
            const v = value.trim();
            resolveDialog(v ? v : null);
        } else {
            resolveDialog(true);
        }
    };

    return (
        <>
            <div className="scrim dlg-scrim" onClick={cancel} />
            <div className="pop dlg-pop" role="dialog" aria-modal="true">
                <div className="hd">
                    <b>{dialog.title}</b>
                </div>
                {dialog.kind === "prompt" ? (
                    <input
                        ref={inputRef}
                        className="dlg-input"
                        type="text"
                        value={value}
                        placeholder={dialog.placeholder}
                        onChange={(e) => setValue(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") ok();
                        }}
                    />
                ) : (
                    dialog.body && <div className="dlg-body">{dialog.body}</div>
                )}
                <div className="dlg-actions">
                    <button className="btn" onClick={cancel}>
                        {t("btn.cancel")}
                    </button>
                    <button
                        className={`btn ${dialog.kind === "confirm" && dialog.danger ? "warn" : "pri"}`}
                        onClick={ok}
                    >
                        {t("dlg.ok")}
                    </button>
                </div>
            </div>
        </>
    );
}
