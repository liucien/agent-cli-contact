import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import type {
    AgentSendKeysParams,
    AgentSnapshot,
    AgentTextParams,
    PromptImage,
    ShellProjection,
    ThreadRecord,
    ToolCallItem,
    WorkspaceIdParams,
} from "@agent-cli-contact/contracts";
import {
    appendHistory,
    call,
    composeAgent,
    fetchHistory,
    openConfig,
    promptDialog,
    renameAgent,
    setScreen,
    toast,
    type ComposingAgentInfo,
} from "../store";
import {
    ctxLabel,
    fmtTime,
    modelLabel,
    permLabel,
    reasoningLabel,
    statusClass,
    termLineClass,
} from "../util";
import {
    extractLiveAssistantBlocks,
    parseScreen,
    sanitizePaneText,
    type Block,
} from "../util/parseScreen";
import { useI18n } from "../i18n";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

interface AttachedImage {
    name: string;
    dataBase64: string;
    previewUrl: string;
}

/** FileReader → base64（去掉 data:*;base64, 前缀） */
function readAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const res = String(reader.result);
            const idx = res.indexOf("base64,");
            resolve(idx >= 0 ? res.slice(idx + 7) : res);
        };
        reader.onerror = () => reject(new Error("file read failed"));
        reader.readAsDataURL(file);
    });
}

/** diff 行拆出行号（置灰）与内容 */
function DiffLine({ kind, text }: { kind: "add" | "del" | "ctx"; text: string }) {
    const m = text.match(/^(\s*\d+\s*)(.*)$/);
    return (
        <div className={`d-${kind}`}>
            {m ? (
                <>
                    <span className="ln">{m[1]}</span>
                    {m[2] === "" ? " " : m[2]}
                </>
            ) : text === "" ? (
                " "
            ) : (
                text
            )}
        </div>
    );
}

function MenuCard({
    block,
    agentId,
}: {
    block: Extract<Block, { type: "menu" }>;
    agentId: string;
}) {
    // 以菜单内容 hash 记录"已作答"，同一菜单点击后全部禁用；菜单消失/更换时自动复位
    const hash = useMemo(
        () => JSON.stringify([block.question, block.options.map((o) => `${o.num}.${o.label}`)]),
        [block],
    );
    const [answeredHash, setAnsweredHash] = useState<string | null>(null);
    const [pendingTarget, setPendingTarget] = useState<number | null>(null);
    const disabled = answeredHash === hash;

    // 通用协议：方向键把 ❯ 移到目标项再回车（数字直选只有部分菜单支持）
    const pick = (target: number) => {
        setAnsweredHash(hash);
        setPendingTarget(target);
        const current = block.options.find((o) => o.selected)?.num ?? 1;
        const delta = target - current;
        const keys = [
            ...(delta > 0 ? Array<string>(delta).fill("Down") : Array<string>(-delta).fill("Up")),
            "Enter",
        ];
        const params: AgentSendKeysParams = { agentId, keys };
        void call("agent.sendKeys", params);
        // 自动加速历史与进度刷新
        setTimeout(() => fetchHistory(agentId), 300);
        setTimeout(() => fetchHistory(agentId), 1200);
        // 8 秒超时保护：若由于终端未响应造成卡住，自动解除禁用允许重试
        setTimeout(() => {
            setAnsweredHash((prev) => (prev === hash ? null : prev));
            setPendingTarget((prev) => (prev === target ? null : prev));
        }, 8000);
    };

    return (
        <div className="menu-card">
            {block.question && (
                <div className="q" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {block.question}
                </div>
            )}
            {block.options.map((o) => {
                const isPending = disabled && pendingTarget === o.num;
                return (
                    <button
                        key={o.num}
                        className={`opt${o.selected ? " sel" : ""}${isPending ? " pending" : ""}`}
                        disabled={disabled}
                        onClick={() => pick(o.num)}
                    >
                        <span className="nb">{isPending ? "⋯" : o.num}</span>
                        <span className="lb">
                            {o.label}
                            {isPending && (
                                <span style={{ marginLeft: 8, opacity: 0.8, fontSize: "0.85em" }}>
                                    （正在执行…）
                                </span>
                            )}
                        </span>
                    </button>
                );
            })}
            {block.hint && <div className="hint">{block.hint}</div>}
        </div>
    );
}

/** 结构化 block 列表渲染（历史帧解析时关闭菜单，故 MenuCard 只会出现在实时帧） */
function Blocks({ blocks, agentId }: { blocks: Block[]; agentId: string }) {
    return (
        <>
            {blocks.map((b, bi) =>
                b.type === "text" ? (
                    <div key={bi}>
                        {b.lines.map((line, i) => (
                            <div key={i} className={termLineClass(line)}>
                                {line === "" ? " " : line}
                            </div>
                        ))}
                    </div>
                ) : b.type === "diff" ? (
                    <div key={bi} className="diff-card">
                        {b.lines.map((l, i) => (
                            <DiffLine key={i} kind={l.kind} text={l.text} />
                        ))}
                    </div>
                ) : (
                    <MenuCard key={bi} block={b} agentId={agentId} />
                ),
            )}
        </>
    );
}

/** gateway 注入 prompt 时给附图段落加的标记 */
const IMAGES_MARKER = "[附图，请读取以下图片文件]";

/** 用户 prompt 记录行：❯ 前缀 + 主文本；附图路径渲染成 📎 chips */
function UserRecordRow({ text }: { text: string }) {
    const idx = text.indexOf(IMAGES_MARKER);
    const main = idx >= 0 ? text.slice(0, idx).trimEnd() : text;
    const paths =
        idx >= 0
            ? text
                  .slice(idx + IMAGES_MARKER.length)
                  .split("\n")
                  .map((s) => s.trim())
                  .filter((s) => s !== "")
            : [];
    return (
        <div className="prompt-row">
            <span className="pfx">❯ </span>
            {main}
            {paths.length > 0 && (
                <span className="pimgs">
                    {paths.map((p, i) => (
                        <span key={i} className="pimg" title={p}>
                            📎 {p.split(/[\\/]/).pop() ?? p}
                        </span>
                    ))}
                </span>
            )}
        </div>
    );
}

/** 助手历史帧：内缩容器 + 时间戳头；帧内菜单渲染为纯文本（不可交互） */
function AssistantRecord({ rec }: { rec: ThreadRecord }) {
    const blocks = useMemo(() => parseScreen(rec.text, false), [rec.text]);
    return (
        <div className="hist-frame">
            <div className="hist-hd">{fmtTime(rec.at)}</div>
            <Blocks blocks={blocks} agentId="" />
        </div>
    );
}

/** 会话线程视图：历史记录（gateway 自录）+ 分隔线 + 实时屏幕帧 */
function ThreadView({
    history,
    paneText,
    agentId,
}: {
    history: ThreadRecord[];
    paneText: string;
    agentId: string;
}) {
    const { t } = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    const liveBlocks = useMemo(() => parseScreen(paneText), [paneText]);

    // 实时帧与最后一条 assistant 记录完全相同（turn 刚结束）→ 跳过该条历史避免重复
    const items = useMemo(() => {
        const last = history[history.length - 1];
        if (last && last.role === "assistant" && last.text === paneText) {
            return history.slice(0, -1);
        }
        return history;
    }, [history, paneText]);

    useEffect(() => {
        const el = ref.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [paneText, items.length]);

    return (
        <div className="term mono" ref={ref}>
            {items.map((rec, i) =>
                rec.role === "user" ? (
                    <UserRecordRow key={i} text={rec.text} />
                ) : (
                    <AssistantRecord key={i} rec={rec} />
                ),
            )}
            {items.length > 0 && <div className="thread-divider">{t("main.liveDivider")}</div>}
            {liveBlocks.length === 0 ? (
                <div className="term-empty">{t("main.termEmpty")}</div>
            ) : (
                <Blocks blocks={liveBlocks} agentId={agentId} />
            )}
        </div>
    );
}

function MarkdownBody({ text }: { text: string }) {
    const html = useMemo(() => {
        if (!text) return "";
        try {
            return marked.parse(text, { async: false, breaks: true, gfm: true }) as string;
        } catch {
            return text;
        }
    }, [text]);

    return <div className="md-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

function ThinkingBlock({ thinking }: { thinking: string }) {
    const [open, setOpen] = useState(false);
    const { t } = useI18n();
    const firstLine = useMemo(() => {
        const raw = thinking.trim().split("\n")[0] ?? "";
        return raw.replace(/^[#*`\s]+/, "").slice(0, 48);
    }, [thinking]);

    return (
        <div className={`thinking-box${open ? " open" : ""}`}>
            <button
                type="button"
                className="thinking-toggle"
                onClick={() => setOpen(!open)}
                title={t("main.thinking")}
            >
                <span className="th-caret">{open ? "▾" : "▸"}</span>
                <span className="th-icon">💭</span>
                <span className="th-title">{t("main.thinking")}</span>
                {!open && firstLine && <span className="th-summary">{firstLine}…</span>}
            </button>
            {open && <div className="thinking-body">{thinking}</div>}
        </div>
    );
}

function ToolCallsBlock({ toolCalls }: { toolCalls: ToolCallItem[] }) {
    return (
        <div className="tools-strip">
            {toolCalls.map((tc, i) => (
                <div key={i} className="tool-pill" title={tc.summary || tc.name}>
                    <span className="tool-bolt">⚡</span>
                    <span className="tool-name">{tc.name}</span>
                    {tc.summary && tc.summary !== tc.name && (
                        <span className="tool-summary">{tc.summary}</span>
                    )}
                    <span className="tool-done">✓</span>
                </div>
            ))}
        </div>
    );
}

function StreamUserMessage({ rec }: { rec: ThreadRecord }) {
    const { t } = useI18n();
    const rawText = rec.text;
    const isMesh = rawText.startsWith("[mesh ·");
    let meshFrom = "";
    let displayText = rawText;
    if (isMesh) {
        const match = rawText.match(/^\[mesh · 来自 ([^\]]+)\]\s*([\s\S]*)$/);
        if (match) {
            meshFrom = match[1] || "";
            displayText = match[2] || "";
        }
    }

    const idx = displayText.indexOf(IMAGES_MARKER);
    const main = idx >= 0 ? displayText.slice(0, idx).trimEnd() : displayText;
    const paths =
        idx >= 0
            ? displayText
                  .slice(idx + IMAGES_MARKER.length)
                  .split("\n")
                  .map((s) => s.trim())
                  .filter((s) => s !== "")
            : [];

    return (
        <div className="stream-row user">
            <div className={`stream-bubble user${isMesh ? " mesh" : ""}`}>
                {meshFrom && (
                    <div className="mesh-relay-badge">
                        <span className="mesh-relay-icon">⚡</span>
                        <span>{t("main.meshRelay", { from: meshFrom })}</span>
                    </div>
                )}
                <div className="stream-bubble-text">{main}</div>
                {paths.length > 0 && (
                    <div className="stream-bubble-imgs">
                        {paths.map((p, i) => (
                            <span key={i} className="stream-img-chip" title={p}>
                                📎 {p.split(/[\\/]/).pop() ?? p}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function StreamAssistantMessage({ rec }: { rec: ThreadRecord }) {
    const hasStructured = Boolean(rec.thinking || (rec.toolCalls && rec.toolCalls.length > 0));
    const isDiff = !hasStructured && (rec.text.includes("+++") || rec.text.includes("---"));
    const diffBlocks = useMemo(() => (isDiff ? parseScreen(rec.text, false) : []), [isDiff, rec.text]);

    return (
        <div className="stream-row assistant">
            <div className="stream-bubble assistant">
                {rec.thinking && <ThinkingBlock thinking={rec.thinking} />}
                {rec.toolCalls && rec.toolCalls.length > 0 && (
                    <ToolCallsBlock toolCalls={rec.toolCalls} />
                )}
                {isDiff ? (
                    <div className="diff-wrap">
                        <Blocks blocks={diffBlocks} agentId="" />
                    </div>
                ) : (
                    rec.text && <MarkdownBody text={rec.text} />
                )}
            </div>
        </div>
    );
}

function StreamView({
    history,
    paneText,
    agent,
    agentId,
}: {
    history: ThreadRecord[];
    paneText: string;
    agent: AgentSnapshot;
    agentId: string;
}) {
    const { t } = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    const cleanedPane = useMemo(() => sanitizePaneText(paneText), [paneText]);
    const liveBlocks = useMemo(() => parseScreen(cleanedPane), [cleanedPane]);
    const isWorking = agent.status === "working";

    // 实时帧中的交互式菜单（如选择题或权限审批选项）
    const liveMenu = useMemo(
        () => liveBlocks.find((b): b is Extract<Block, { type: "menu" }> => b.type === "menu"),
        [liveBlocks],
    );

    const lastRecord = history[history.length - 1];
    const isUserLast = lastRecord?.role === "user";

    // 当最新一条是用户 prompt（AI 正在流式生成或暂停等待交互）时，提取终端中的实时活跃块（思考、工具执行进度、diff 等）
    const liveAssistantBlocks = useMemo(() => {
        if (!isUserLast) return [];
        return extractLiveAssistantBlocks(liveBlocks, lastRecord?.text);
    }, [isUserLast, liveBlocks, lastRecord?.text]);

    useEffect(() => {
        const el = ref.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [history.length, isWorking, paneText, liveAssistantBlocks.length]);

    return (
        <div className="stream-view" ref={ref}>
            {history.length === 0 && (
                <div className="stream-empty">
                    {isWorking ? (
                        <div className="live-working-card">
                            <span className="pulse-indicator" />
                            <span>AI 正在思考 / 执行工具…</span>
                        </div>
                    ) : (
                        <div className="term-empty">{t("main.termEmpty")}</div>
                    )}
                </div>
            )}

            {history.map((rec, i) =>
                rec.role === "user" ? (
                    <StreamUserMessage key={rec.id ?? `u-${i}`} rec={rec} />
                ) : (
                    <StreamAssistantMessage key={rec.id ?? `a-${i}`} rec={rec} />
                ),
            )}

            {isUserLast && liveAssistantBlocks.length > 0 && (
                <div className="stream-row assistant live-streaming">
                    <div className="stream-bubble assistant">
                        <Blocks blocks={liveAssistantBlocks} agentId={agentId} />
                    </div>
                </div>
            )}

            {liveMenu && (
                <div className="stream-row assistant live-menu">
                    <div className="stream-bubble assistant">
                        <MenuCard block={liveMenu} agentId={agentId} />
                    </div>
                </div>
            )}

            {isWorking && (
                <div className="stream-row assistant live-working">
                    <div className="live-working-card">
                        <span className="pulse-indicator" />
                        <span>AI 正在思考 / 执行工具…</span>
                    </div>
                </div>
            )}
        </div>
    );
}

export function MainPane({
    projection,
    agent,
    paneText,
    history,
    selectedWorkspaceId,
    composingWorkspaceId,
    composingAgent,
    connectingAgentId,
    viewingComposing,
    composerFocusSeq,
}: {
    projection: ShellProjection;
    agent: AgentSnapshot | null;
    paneText: string;
    history: ThreadRecord[];
    selectedWorkspaceId: string | null;
    composingWorkspaceId: string | null;
    composingAgent?: ComposingAgentInfo | null;
    connectingAgentId?: string | null;
    viewingComposing?: boolean;
    composerFocusSeq: number;
}) {
    const { t } = useI18n();
    const [showTerminal, setShowTerminal] = useState(false);
    const [input, setInput] = useState("");
    const [images, setImages] = useState<AttachedImage[]>([]);
    const [sending, setSending] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // compose 成功后自动聚焦 composer
    useEffect(() => {
        inputRef.current?.focus();
    }, [composerFocusSeq]);

    // textarea 随内容自动增高（上限 ~6 行 / 140px，超出滚动）
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
    }, [input]);

    // 卸载时回收缩略图 object URL
    const imagesRef = useRef<AttachedImage[]>([]);
    imagesRef.current = images;
    useEffect(
        () => () => {
            for (const img of imagesRef.current) URL.revokeObjectURL(img.previewUrl);
        },
        [],
    );

    const addFiles = async (files: File[]) => {
        const candidates = files.filter((f) => f.type.startsWith("image/")); // 非图片直接忽略
        if (candidates.length === 0) return;
        const room = MAX_IMAGES - images.length;
        if (candidates.length > room) toast("warn", t("img.tooMany", { max: MAX_IMAGES }));
        const picked: File[] = [];
        for (const f of candidates) {
            if (picked.length >= room) break;
            if (f.size > MAX_IMAGE_BYTES) {
                toast("warn", t("img.tooLarge", { name: f.name || "image" }));
                continue;
            }
            picked.push(f);
        }
        if (picked.length === 0) return;
        try {
            const loaded = await Promise.all(
                picked.map(async (f) => ({
                    name: f.name || "image.png",
                    dataBase64: await readAsBase64(f),
                    previewUrl: URL.createObjectURL(f),
                })),
            );
            setImages((prev) => [...prev, ...loaded].slice(0, MAX_IMAGES));
        } catch {
            // 读取失败静默跳过
        }
    };

    const removeImage = (idx: number) => {
        setImages((prev) => {
            const target = prev[idx];
            if (target) URL.revokeObjectURL(target.previewUrl);
            return prev.filter((_, i) => i !== idx);
        });
    };

    const isCreating = Boolean(
        viewingComposing &&
        composingAgent &&
        composingAgent.workspaceId === selectedWorkspaceId
    );

    const isConnecting = Boolean(
        connectingAgentId &&
        agent &&
        connectingAgentId === agent.id &&
        (!paneText || paneText.trim().length === 0) &&
        history.length === 0
    );

    const isInitializing = isCreating || isConnecting;
    const activeName = isCreating ? composingAgent!.name : agent?.name ?? "";
    const activeKind = isCreating ? composingAgent!.kind : agent?.provider ?? "agent";
    const initStage: "creating" | "connecting" = isCreating ? "creating" : "connecting";

    if (!agent && !isCreating) {
        // 没有任何项目 → 引导创建项目；有项目但没有 agent → hero + 一键新建
        if (projection.workspaces.length === 0) {
            return (
                <div className="main">
                    <div className="rp-placeholder">{t("main.emptyShell")}</div>
                </div>
            );
        }
        const ws = projection.workspaces.find((w) => w.id === selectedWorkspaceId);
        const composing = composingWorkspaceId !== null;
        return (
            <div className="main">
                <div className="hero">
                    <div className="hero-q">{t("main.heroTitle", { name: ws?.label ?? "" })}</div>
                    <button
                        className="btn pri"
                        disabled={composing || !selectedWorkspaceId}
                        onClick={() => selectedWorkspaceId && composeAgent(selectedWorkspaceId)}
                    >
                        ＋ {t("agent.compose")}
                    </button>
                </div>
            </div>
        );
    }

    const send = () => {
        if (isInitializing || sending || !agent) return;
        const text = input.trim();
        if (!text && images.length === 0) return;
        const userText = text || t("img.defaultPrompt");
        const params: AgentTextParams = {
            agentId: agent.id,
            text: userText,
            ...(images.length > 0
                ? {
                      images: images.map((img): PromptImage => ({
                          name: img.name,
                          dataBase64: img.dataBase64,
                      })),
                  }
                : {}),
        };
        // 乐观上屏：无论是否有图，立即以 ThreadRecord 渲染在对话流中
        const optimisticRecord: ThreadRecord = {
            id: `temp-u-${Date.now()}`,
            role: "user",
            text:
                images.length > 0
                    ? `${userText}\n\n${IMAGES_MARKER}\n${images.map((img) => img.name).join("\n")}`
                    : userText,
            at: Date.now(),
        };
        appendHistory(optimisticRecord);

        if (images.length > 0) {
            // base64 载荷可能有几 MB，发送期间禁用发送按钮
            setSending(true);
            call("agent.prompt", params).then(
                () => {
                    for (const img of images) URL.revokeObjectURL(img.previewUrl);
                    setImages([]);
                    setInput("");
                    setSending(false);
                    fetchHistory(agent.id);
                },
                () => setSending(false), // 失败保留附件供重试
            );
        } else {
            setInput("");
            call("agent.prompt", params)
                .then(() => fetchHistory(agent.id))
                .catch(() => undefined);
        }
    };

    const cfg = agent?.config;
    const workspace = projection.workspaces.find(
        (w) => w.id === (agent ? agent.workspaceId : selectedWorkspaceId),
    );
    const openEditor = () => {
        if (!workspace) return;
        const params: WorkspaceIdParams = { workspaceId: workspace.id };
        call("editor.open", params).catch(() => undefined);
    };

    const onRename = async () => {
        if (!agent) return;
        const next = await promptDialog({
            title: t("agent.promptRename"),
            defaultValue: agent.name,
        });
        if (next && next.trim() && next.trim() !== agent.name) {
            await renameAgent(agent.id, next.trim());
        }
    };

    // pane 内容还很"空"且没有任何历史 → Codex 式 hero；有输出/历史后切回流式视图
    const trivialPane = paneText === "" || (agent?.turn === 0 && paneText.split("\n").length < 3);
    const showHero = Boolean(agent && history.length === 0 && trivialPane && !isInitializing);

    return (
        <div className="main">
            <div className="pane-h">
                <div className="agent-title-wrap">
                    <b
                        className="agent-title-text"
                        title={agent ? t("agent.promptRename") : ""}
                        onDoubleClick={() => agent && void onRename()}
                    >
                        {activeName}
                    </b>
                    {agent && (
                        <button
                            className="chip-icon"
                            title={t("agent.rename")}
                            onClick={() => void onRename()}
                        >
                            ✎
                        </button>
                    )}
                </div>
                {isInitializing ? (
                    <span className="pill working">
                        <span className="pulse-indicator" /> {t("agent.connectingStatus")}
                    </span>
                ) : agent ? (
                    <span className={`pill ${statusClass(agent.status)}`}>● {agent.status}</span>
                ) : null}
                {agent?.branch && <span className="pill branch">⎇ {agent.branch}</span>}
                <div className="r">
                    {agent && <span>turn #{agent.turn}</span>}
                    {agent && <span>checkpoint ✓</span>}
                    {workspace?.cwd && (
                        <button className="chip" title={workspace.cwd} onClick={openEditor}>
                            ⧉ {t("main.openEditor")}
                        </button>
                    )}
                    <button className="chip" onClick={() => setScreen("mesh")}>
                        {t("main.meshView")}
                    </button>
                    {agent && !isInitializing && (
                        <button
                            className={`chip toggle-mode${showTerminal ? " active" : ""}`}
                            onClick={() => setShowTerminal(!showTerminal)}
                            title={showTerminal ? t("main.toggleChat") : t("main.toggleTerminal")}
                        >
                            {showTerminal ? `💬 ${t("main.toggleChat")}` : `▤ ${t("main.toggleTerminal")}`}
                        </button>
                    )}
                </div>
            </div>

            {isInitializing ? (
                <div className="terminal-init-wrap">
                    <div className="terminal-init-card">
                        <div className="terminal-init-icon">
                            <span className="pulse-halo" />
                            <svg
                                viewBox="0 0 24 24"
                                width="36"
                                height="36"
                                stroke="currentColor"
                                fill="none"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <polyline points="4 17 10 11 4 5" />
                                <line x1="12" y1="19" x2="20" y2="19" />
                            </svg>
                        </div>
                        <div className="terminal-init-title">
                            {initStage === "creating"
                                ? t("agent.startingAgent", { name: activeName })
                                : t("agent.connectingTerminal", { name: activeName })}
                        </div>
                        <div className="terminal-init-sub">
                            {t("agent.connectingHint", { kind: activeKind })}
                        </div>
                        <div className="terminal-init-steps">
                            <div className="init-step active done">
                                <span className="step-icon">✓</span>
                                <span className="step-text">{t("agent.stepPane")}</span>
                            </div>
                            <div
                                className={`init-step ${initStage === "connecting" ? "active done" : "pending"}`}
                            >
                                <span className="step-icon">
                                    {initStage === "connecting" ? "✓" : "2"}
                                </span>
                                <span className="step-text">{t("agent.stepSession")}</span>
                            </div>
                            <div className="init-step active running">
                                <span className="step-icon spinner" />
                                <span className="step-text">{t("agent.stepReady")}</span>
                            </div>
                        </div>
                        <div className="terminal-init-bar">
                            <div className="terminal-init-progress" />
                        </div>
                    </div>
                </div>
            ) : showHero ? (
                <div className="hero">
                    <div className="hero-q">
                        {t("main.heroTitle", { name: workspace?.label ?? agent!.name })}
                    </div>
                    <div className="hero-sub">{t("main.heroSub", { agent: agent!.name })}</div>
                </div>
            ) : showTerminal ? (
                <ThreadView history={history} paneText={paneText} agentId={agent!.id} />
            ) : (
                <StreamView
                    history={history}
                    paneText={paneText}
                    agent={agent!}
                    agentId={agent!.id}
                />
            )}

            <div className={`composer-wrap${isInitializing ? " disabled" : ""}`}>
                <div className="cfgbar">
                    <button
                        className="cfgseg"
                        disabled={isInitializing || !agent}
                        onClick={() => agent && openConfig(agent.id)}
                    >
                        <span className="ic">✳</span>{" "}
                        {agent ? modelLabel(projection, agent) : activeKind}{" "}
                        <span className="dn">▾</span>
                    </button>
                    <button
                        className="cfgseg"
                        disabled={isInitializing || !agent}
                        onClick={() => agent && openConfig(agent.id)}
                    >
                        {agent && cfg
                            ? `${reasoningLabel(cfg.reasoning)} · ${ctxLabel(cfg.contextWindow)}`
                            : "normal · 200k"}{" "}
                        <span className="dn">▾</span>
                    </button>
                    <button
                        className="cfgseg"
                        disabled={isInitializing || !agent}
                        onClick={() => agent && openConfig(agent.id)}
                    >
                        <span className="lock">
                            {cfg?.permissionMode === "full" ? "🔓" : "🔒"}
                        </span>{" "}
                        {cfg ? permLabel(cfg.permissionMode) : "auto"}{" "}
                        <span className="dn">▾</span>
                    </button>
                </div>
                {images.length > 0 && (
                    <div className="attach-strip">
                        {images.map((img, i) => (
                            <span key={img.previewUrl} className="attach-item">
                                <img src={img.previewUrl} alt="" />
                                <span className="nm" title={img.name}>
                                    {img.name}
                                </span>
                                <button className="rm" onClick={() => removeImage(i)}>
                                    ✕
                                </button>
                            </span>
                        ))}
                    </div>
                )}
                <div className="composer">
                    <input
                        ref={fileRef}
                        type="file"
                        accept={IMAGE_ACCEPT}
                        multiple
                        style={{ display: "none" }}
                        onChange={(e) => {
                            void addFiles(Array.from(e.target.files ?? []));
                            e.target.value = "";
                        }}
                    />
                    <button
                        className="attach-btn"
                        title={t("img.attach")}
                        disabled={isInitializing}
                        onClick={() => fileRef.current?.click()}
                    >
                        📎
                    </button>
                    <textarea
                        ref={inputRef}
                        rows={1}
                        disabled={isInitializing}
                        placeholder={
                            isInitializing
                                ? t("main.inputConnecting")
                                : t("main.inputPlaceholder", { name: activeName })
                        }
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPaste={(e) => {
                            if (isInitializing) return;
                            const files = Array.from(e.clipboardData.files).filter((f) =>
                                f.type.startsWith("image/"),
                            );
                            if (files.length > 0) {
                                e.preventDefault();
                                void addFiles(files);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (isInitializing) return;
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                send();
                            }
                        }}
                    />
                    <span className="hint">{t("main.kbdHint")}</span>
                    <button
                        className="send"
                        onClick={send}
                        disabled={isInitializing || sending}
                    >
                        {isInitializing ? t("main.initializingBtn") : t("main.send")}
                    </button>
                </div>
            </div>
        </div>
    );
}
