import { useEffect, useMemo, useRef, useState } from "react";
import type {
    AgentApplyConfigParams,
    AgentApplyConfigResult,
    AgentConfig,
    AgentIdParams,
    AgentSnapshot,
    PresetSaveParams,
    ShellProjection,
} from "@agent-cli-contact/contracts";
import { call, closeConfig, promptDialog, toast } from "../store";
import { rpc } from "../ws";
import { useI18n } from "../i18n";

function sameConfig(a: AgentConfig, b: AgentConfig): boolean {
    return (
        a.model === b.model &&
        a.reasoning === b.reasoning &&
        a.contextWindow === b.contextWindow &&
        a.permissionMode === b.permissionMode
    );
}

export function ConfigPopover({
    projection,
    agent,
}: {
    projection: ShellProjection;
    agent: AgentSnapshot;
}) {
    const { t } = useI18n();
    const [config, setConfig] = useState<AgentConfig>({ ...agent.config });
    /** 本次弹层会话内用户是否手动选过模型（选过则不再跟随投影） */
    const userTouchedModel = useRef(false);

    // 打开时让 gateway 从 provider 会话文件同步真实模型（fire-and-forget，静默失败）
    useEffect(() => {
        const params: AgentIdParams = { agentId: agent.id };
        rpc("agent.syncConfig", params).catch(() => {});
    }, [agent.id]);

    // 投影里的模型变化时（sync 结果广播），未被用户改动过则跟随
    const projectedModel = agent.config.model;
    useEffect(() => {
        if (userTouchedModel.current) return;
        setConfig((c) => (c.model === projectedModel ? c : { ...c, model: projectedModel }));
    }, [projectedModel]);

    const permOptions: { id: AgentConfig["permissionMode"]; name: string; note: string }[] = [
        { id: "plan", name: "Plan", note: t("cfg.permPlanNote") },
        { id: "ask", name: "Ask", note: t("cfg.permAskNote") },
        { id: "full", name: "Full access", note: t("cfg.permFullNote") },
    ];

    const cap = useMemo(
        () => projection.capabilities.find((c) => c.provider === agent.provider),
        [projection.capabilities, agent.provider],
    );
    // 当前模型不在 provider 能力列表里（会话文件检测到的新模型）→ 置顶补一个选项
    const capModels = cap?.models ?? [];
    const models = capModels.some((m) => m.id === agent.config.model)
        ? capModels
        : [
              { id: agent.config.model, label: agent.config.model, note: t("cfg.detectedNote") },
              ...capModels,
          ];

    const patch = (p: Partial<AgentConfig>) => setConfig((c) => ({ ...c, ...p }));

    const savePreset = () => {
        void promptDialog({ title: t("cfg.presetNamePrompt") }).then((name) => {
            if (!name) return;
            const params: PresetSaveParams = { name, config };
            void call("preset.save", params).then(
                () => toast("info", t("cfg.presetSaved", { name })),
                () => undefined,
            );
        });
    };

    const apply = () => {
        const params: AgentApplyConfigParams = { agentId: agent.id, config };
        void call("agent.applyConfig", params).then(
            (result) => {
                const r = result as AgentApplyConfigResult;
                const sep = t("cfg.listSep");
                const parts: string[] = [];
                if (r.applied.length > 0)
                    parts.push(t("cfg.appliedNow", { items: r.applied.join(sep) }));
                if (r.queued.length > 0)
                    parts.push(t("cfg.queuedTurn", { items: r.queued.join(sep) }));
                if (r.restartRequired.length > 0)
                    parts.push(t("cfg.restartRequired", { items: r.restartRequired.join(sep) }));
                toast("info", parts.length > 0 ? parts.join(t("cfg.partSep")) : t("cfg.noChange"));
                closeConfig();
            },
            () => undefined,
        );
    };

    return (
        <>
            <div className="scrim" onClick={closeConfig} />
            <div className="pop" role="dialog" aria-modal="true">
                <div className="hd">
                    <b>{t("cfg.title")}</b>
                    <span className="who">
                        {agent.name} · {agent.provider}
                    </span>
                    <button className="save" onClick={savePreset}>
                        {t("cfg.savePreset")}
                    </button>
                </div>

                <div className="cols">
                    <div>
                        <div className="col-h">{t("cfg.model")}</div>
                        {models.map((m) => (
                            <button
                                key={m.id}
                                className={`opt${config.model === m.id ? " sel" : ""}`}
                                onClick={() => {
                                    userTouchedModel.current = true;
                                    patch({ model: m.id });
                                }}
                            >
                                <span className="radio" />
                                <span className="nm">
                                    {m.label} {m.note && <i>{m.note}</i>}
                                </span>
                                {agent.config.model === m.id && (
                                    <span className="tag2">{t("cfg.current")}</span>
                                )}
                            </button>
                        ))}
                    </div>

                    <div>
                        <div className="col-h">{t("cfg.reasoning")}</div>
                        <div className="seg">
                            {(["low", "medium", "high"] as const).map((r) => (
                                <button
                                    key={r}
                                    className={config.reasoning === r ? "sel" : ""}
                                    onClick={() => patch({ reasoning: r })}
                                >
                                    {r === "low" ? "Low" : r === "medium" ? "Medium" : "High"}
                                </button>
                            ))}
                        </div>
                        <div className="col-h" style={{ marginTop: 12 }}>
                            {t("cfg.context")}
                        </div>
                        <div className="seg">
                            {(["200k", "1m"] as const).map((c) => (
                                <button
                                    key={c}
                                    className={config.contextWindow === c ? "sel" : ""}
                                    onClick={() => patch({ contextWindow: c })}
                                >
                                    {c === "200k" ? "200K" : "1M"}
                                </button>
                            ))}
                        </div>
                        <div className="note">{t("cfg.reasoningNote")}</div>
                    </div>

                    <div>
                        <div className="col-h">{t("cfg.permission")}</div>
                        {permOptions.map((p) => (
                            <button
                                key={p.id}
                                className={`opt${config.permissionMode === p.id ? " sel" : ""}`}
                                onClick={() => patch({ permissionMode: p.id })}
                            >
                                <span className="radio" />
                                <span className="nm">
                                    {p.name} <i>{p.note}</i>
                                </span>
                                {p.id === "full" && <span className="tag2">🔓</span>}
                            </button>
                        ))}
                        {config.permissionMode === "full" && (
                            <div className="note">
                                <span className="warn">{t("cfg.fullWarn")}</span>
                                {t("cfg.fullWarn2")}
                            </div>
                        )}
                    </div>
                </div>

                <div className="presets">
                    <span className="lb">{t("cfg.presets")}</span>
                    {projection.presets.map((p) => (
                        <button
                            key={p.id}
                            className={`preset${sameConfig(p.config, config) ? " sel" : ""}`}
                            onClick={() => {
                                userTouchedModel.current = true; // 预设也携带模型选择
                                setConfig({ ...p.config });
                            }}
                        >
                            {p.name}
                        </button>
                    ))}
                    <button className="preset add" onClick={savePreset}>
                        {t("cfg.newPreset")}
                    </button>
                </div>

                <div className="ft">
                    <div className="how">
                        <b>{t("cfg.howTitle")}</b>
                        {t("cfg.howBody")}
                    </div>
                    <button className="apply" onClick={apply}>
                        {t("cfg.apply")}
                    </button>
                </div>
            </div>
        </>
    );
}
