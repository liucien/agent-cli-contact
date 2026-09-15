import { useState } from "react";
import type { MeshMessage, MeshApproveParams } from "@workbench/contracts";
import type { ShellProjection } from "@workbench/contracts";
import { call } from "../store";
import { fmtTime, partyName } from "../util";
import { useI18n, type MsgKey } from "../i18n";

const STATUS_TAG: Record<MeshMessage["status"], { cls: string; key: MsgKey }> = {
    injected: { cls: "ok", key: "status.injected" },
    held: { cls: "hold", key: "status.held" },
    queued: { cls: "queued", key: "status.queued" },
    denied: { cls: "denied", key: "status.denied" },
};

/** 待放行消息的 放行/编辑/驳回 按钮组（含内联编辑态） */
export function HeldActions({ message }: { message: MeshMessage }) {
    const { t } = useI18n();
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(message.body);

    const approve = (editedBody?: string) => {
        const params: MeshApproveParams = { messageId: message.id, editedBody };
        void call("mesh.approve", params);
    };
    const deny = () => {
        void call("mesh.deny", { messageId: message.id });
    };

    if (editing) {
        return (
            <div>
                <textarea
                    className="edit-area"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    autoFocus
                />
                <div className="actions">
                    <button className="btn pri" onClick={() => approve(draft)}>
                        {t("btn.confirmApprove")}
                    </button>
                    <button className="btn" onClick={() => setEditing(false)}>
                        {t("btn.cancel")}
                    </button>
                </div>
            </div>
        );
    }
    return (
        <div className="actions">
            <button className="btn pri" onClick={() => approve()}>
                {t("btn.approveInject")}
            </button>
            <button className="btn" onClick={() => setEditing(true)}>
                {t("btn.editApprove")}
            </button>
            <button className="btn warn" onClick={deny}>
                {t("btn.reject")}
            </button>
        </div>
    );
}

export function MessageCard({
    message,
    projection,
}: {
    message: MeshMessage;
    projection: ShellProjection | null;
}) {
    const { t } = useI18n();
    const tag = STATUS_TAG[message.status];
    return (
        <div className="msg">
            <div className="hd">
                <b>{partyName(projection, message.from)}</b> →{" "}
                <b>{partyName(projection, message.to)}</b>
                <span className={`tag ${tag.cls}`}>{t(tag.key)}</span>
                <span className="t">{fmtTime(message.createdAt)}</span>
            </div>
            <div className="bd">{message.body}</div>
            {message.attachment && (
                <span className="attach">
                    ⎘ {message.attachment.label}
                    {message.attachment.diffStat ? ` · ${message.attachment.diffStat}` : ""}
                </span>
            )}
            {message.status === "held" && <HeldActions message={message} />}
        </div>
    );
}
