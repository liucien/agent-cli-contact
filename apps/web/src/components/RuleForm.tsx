import { useState } from "react";
import type { AgentSnapshot, MeshRuleCreateParams } from "@workbench/contracts";
import { call } from "../store";
import { useI18n } from "../i18n";

type TriggerState = MeshRuleCreateParams["triggerState"];

export function RuleForm({ agents, onClose }: { agents: AgentSnapshot[]; onClose: () => void }) {
    const { t } = useI18n();
    const [watcher, setWatcher] = useState(agents[0]?.id ?? "");
    const [trigger, setTrigger] = useState<TriggerState>("done");
    const [target, setTarget] = useState(agents[1]?.id ?? agents[0]?.id ?? "");
    const [prompt, setPrompt] = useState("");
    const [oneShot, setOneShot] = useState(true);

    const create = () => {
        if (!watcher || !target || !prompt.trim()) return;
        const params: MeshRuleCreateParams = {
            watcherAgent: watcher,
            targetAgent: target,
            triggerState: trigger,
            actionPrompt: prompt.trim(),
            oneShot,
        };
        void call("mesh.rule.create", params).then(onClose, () => undefined);
    };

    return (
        <div className="rule-form">
            <div className="row-f">
                <select value={watcher} onChange={(e) => setWatcher(e.target.value)}>
                    {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name}
                        </option>
                    ))}
                </select>
                <span style={{ color: "var(--dim)" }}>{t("rule.enters")}</span>
                <select
                    value={trigger}
                    onChange={(e) => setTrigger(e.target.value as TriggerState)}
                >
                    <option value="done">done</option>
                    <option value="blocked">blocked</option>
                    <option value="idle">idle</option>
                </select>
                <span style={{ color: "var(--dim)" }}>{t("rule.then")}</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                    {agents.map((a) => (
                        <option key={a.id} value={a.id}>
                            {a.name}
                        </option>
                    ))}
                </select>
            </div>
            <div className="row-f">
                <input
                    type="text"
                    placeholder={t("rule.promptPlaceholder")}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") create();
                    }}
                />
            </div>
            <div className="row-f">
                <label className="ck">
                    <input
                        type="checkbox"
                        checked={oneShot}
                        onChange={(e) => setOneShot(e.target.checked)}
                    />
                    {t("rule.oneShot")}
                </label>
                <span style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
                    <button className="btn pri" onClick={create}>
                        {t("btn.create")}
                    </button>
                    <button className="btn" onClick={onClose}>
                        {t("btn.cancel")}
                    </button>
                </span>
            </div>
        </div>
    );
}
