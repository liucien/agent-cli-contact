/**
 * per-provider capability 表（PLAN §5.4）：每个配置项走「即时注入 / 重启会话 /
 * 不支持」哪条生效路径，UI 据此置灰不支持项。
 */
import type { ProviderCapabilities } from "@agent-cli-contact/contracts";

export const PROVIDER_CAPABILITIES: ProviderCapabilities[] = [
    {
        provider: "Claude Code",
        sessionModelSwitch: "immediate", // /model slash 命令
        reasoningSwitch: "immediate",
        permissionSwitch: "restart", // --permission-mode 仅启动参数
        models: [
            { id: "claude-fable-5", label: "Claude Fable 5", note: "最强推理 · 1M 上下文" },
            { id: "claude-opus-5", label: "Claude Opus 5", note: "均衡 · fast 模式可用" },
            { id: "claude-sonnet-5", label: "Claude Sonnet 5", note: "速度优先" },
            { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", note: "轻量任务" },
        ],
    },
    {
        provider: "Codex",
        sessionModelSwitch: "immediate",
        reasoningSwitch: "immediate",
        permissionSwitch: "restart",
        models: [
            { id: "gpt-5.3-codex", label: "gpt-5.3-codex", note: "默认" },
            { id: "gpt-5.3-codex-mini", label: "gpt-5.3-codex-mini", note: "轻量任务" },
        ],
    },
    {
        provider: "Antigravity",
        sessionModelSwitch: "restart",
        reasoningSwitch: "unsupported",
        permissionSwitch: "restart",
        models: [{ id: "gemini-3-pro", label: "Gemini 3 Pro", note: "默认" }],
    },
    {
        provider: "Cursor Agent",
        sessionModelSwitch: "restart",
        reasoningSwitch: "unsupported",
        permissionSwitch: "restart",
        models: [{ id: "claude-3.5-sonnet", label: "Claude 3.5 Sonnet", note: "默认" }],
    },
    {
        provider: "OpenCode",
        sessionModelSwitch: "restart",
        reasoningSwitch: "unsupported",
        permissionSwitch: "restart",
        models: [{ id: "default", label: "Default Model", note: "默认" }],
    },
    {
        provider: "Pi",
        sessionModelSwitch: "restart",
        reasoningSwitch: "unsupported",
        permissionSwitch: "restart",
        models: [{ id: "default", label: "Default Model", note: "默认" }],
    },
];

export function capabilitiesFor(provider: string): ProviderCapabilities {
    return (
        PROVIDER_CAPABILITIES.find((c) => c.provider === provider) ?? {
            provider,
            sessionModelSwitch: "unsupported",
            reasoningSwitch: "unsupported",
            permissionSwitch: "unsupported",
            models: [],
        }
    );
}

/** 模型 id -> 配置条/侧栏显示的短名 */
export function modelLabel(modelId: string): string {
    for (const cap of PROVIDER_CAPABILITIES) {
        const m = cap.models.find((m) => m.id === modelId);
        if (m) return m.label;
    }
    return modelId;
}
