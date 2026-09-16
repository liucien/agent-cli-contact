import { useEffect, useMemo, useRef, useState } from "react";
import type {
    AgentSendKeysParams,
    AgentSnapshot,
    AgentTextParams,
    PromptImage,
    ShellProjection,
    ThreadRecord,
    WorkspaceIdParams,
} from "@agent-cli-contact/contracts";
import { call, composeAgent, openConfig, setScreen, toast } from "../store";
import {
    ctxLabel,
    fmtTime,
    modelLabel,
    permLabel,
    reasoningLabel,
    statusClass,
    termLineClass,
} from "../util";
import { parseScreen, type Block } from "../util/parseScreen";
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
    const disabled = answeredHash === hash;

    // 通用协议：方向键把 ❯ 移到目标项再回车（数字直选只有部分菜单支持）
    const pick = (target: number) => {
        setAnsweredHash(hash);
        const current = block.options.find((o) => o.selected)?.num ?? 1;
        const delta = target - current;
        const keys = [
            ...(delta > 0 ? Array<string>(delta).fill("Down") : Array<string>(-delta).fill("Up")),
            "Enter",
        ];
        const params: AgentSendKeysParams = { agentId, keys };
        void call("agent.sendKeys", params);
    };

    return (
        <div className="menu-card">
            {block.question && <div className="q">{block.question}</div>}
            {block.options.map((o) => (
                <button
                    key={o.num}
                    className={`opt${o.selected ? " sel" : ""}`}
                    disabled={disabled}
                    onClick={() => pick(o.num)}
                >
                    <span className="nb">{o.num}</span>
                    <span className="lb">{o.label}</span>
                </button>
            ))}
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

export function MainPane({
    projection,
    agent,
    paneText,
    history,
    selectedWorkspaceId,
    composingWorkspaceId,
    composerFocusSeq,
}: {
    projection: ShellProjection;
    agent: AgentSnapshot | null;
    paneText: string;
    history: ThreadRecord[];
    selectedWorkspaceId: string | null;
    composingWorkspaceId: string | null;
    composerFocusSeq: number;
}) {
    const { t } = useI18n();
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

    if (!agent) {
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
        if (sending) return;
        const text = input.trim();
        if (!text && images.length === 0) return;
        const params: AgentTextParams = {
            agentId: agent.id,
            // 只有图片没有文字时，给 CLI 一句默认指令
            text: text || t("img.defaultPrompt"),
            ...(images.length > 0
                ? {
                      images: images.map((img): PromptImage => ({
                          name: img.name,
                          dataBase64: img.dataBase64,
                      })),
                  }
                : {}),
        };
        if (images.length > 0) {
            // base64 载荷可能有几 MB，发送期间禁用发送按钮
            setSending(true);
            call("agent.prompt", params).then(
                () => {
                    for (const img of images) URL.revokeObjectURL(img.previewUrl);
                    setImages([]);
                    setInput("");
                    setSending(false);
                },
                () => setSending(false), // 失败保留附件供重试
            );
        } else {
            void call("agent.prompt", params);
            setInput("");
        }
    };

    const cfg = agent.config;
    const workspace = projection.workspaces.find((w) => w.id === agent.workspaceId);
    const openEditor = () => {
        if (!workspace) return;
        const params: WorkspaceIdParams = { workspaceId: workspace.id };
        call("editor.open", params).catch(() => undefined);
    };

    // pane 内容还很"空"且没有任何历史 → Codex 式 hero；有输出/历史后切回线程视图
    const trivialPane = paneText === "" || (agent.turn === 0 && paneText.split("\n").length < 3);
    const showHero = history.length === 0 && trivialPane;

    return (
        <div className="main">
            <div className="pane-h">
                <b>{agent.name}</b>
                <span className={`pill ${statusClass(agent.status)}`}>● {agent.status}</span>
                {agent.branch && <span className="pill branch">⎇ {agent.branch}</span>}
                <div className="r">
                    <span>turn #{agent.turn}</span>
                    <span>checkpoint ✓</span>
                    {workspace?.cwd && (
                        <button className="chip" title={workspace.cwd} onClick={openEditor}>
                            ⧉ {t("main.openEditor")}
                        </button>
                    )}
                    <button className="chip" onClick={() => setScreen("mesh")}>
                        {t("main.meshView")}
                    </button>
                </div>
            </div>

            {showHero ? (
                <div className="hero">
                    <div className="hero-q">
                        {t("main.heroTitle", { name: workspace?.label ?? agent.name })}
                    </div>
                    <div className="hero-sub">{t("main.heroSub", { agent: agent.name })}</div>
                </div>
            ) : (
                <ThreadView history={history} paneText={paneText} agentId={agent.id} />
            )}

            <div className="composer-wrap">
                <div className="cfgbar">
                    <button className="cfgseg" onClick={() => openConfig(agent.id)}>
                        <span className="ic">✳</span> {modelLabel(projection, agent)}{" "}
                        <span className="dn">▾</span>
                    </button>
                    <button className="cfgseg" onClick={() => openConfig(agent.id)}>
                        {reasoningLabel(cfg.reasoning)} · {ctxLabel(cfg.contextWindow)}{" "}
                        <span className="dn">▾</span>
                    </button>
                    <button className="cfgseg" onClick={() => openConfig(agent.id)}>
                        <span className="lock">{cfg.permissionMode === "full" ? "🔓" : "🔒"}</span>{" "}
                        {permLabel(cfg.permissionMode)} <span className="dn">▾</span>
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
                        onClick={() => fileRef.current?.click()}
                    >
                        📎
                    </button>
                    <textarea
                        ref={inputRef}
                        rows={1}
                        placeholder={t("main.inputPlaceholder", { name: agent.name })}
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onPaste={(e) => {
                            const files = Array.from(e.clipboardData.files).filter((f) =>
                                f.type.startsWith("image/"),
                            );
                            if (files.length > 0) {
                                e.preventDefault();
                                void addFiles(files);
                            }
                        }}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                                e.preventDefault();
                                send();
                            }
                        }}
                    />
                    <span className="hint">{t("main.kbdHint")}</span>
                    <button className="send" onClick={send} disabled={sending}>
                        {t("main.send")}
                    </button>
                </div>
            </div>
        </div>
    );
}
