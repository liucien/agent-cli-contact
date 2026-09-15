import { useEffect, useRef, useState } from "react";
import type {
    AgentSnapshot,
    AgentTextParams,
    PromptImage,
    ShellProjection,
    WorkspaceIdParams,
} from "@agent-cli-contact/contracts";
import { call, composeAgent, openConfig, setScreen, toast } from "../store";
import {
    ctxLabel,
    modelLabel,
    permLabel,
    reasoningLabel,
    statusClass,
    termLineClass,
} from "../util";
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

function Terminal({ text }: { text: string }) {
    const { t } = useI18n();
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const el = ref.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [text]);

    const lines = text.length > 0 ? text.split("\n") : [];
    return (
        <div className="term mono" ref={ref}>
            {lines.length === 0 ? (
                <div className="term-empty">{t("main.termEmpty")}</div>
            ) : (
                lines.map((line, i) => (
                    <div key={i} className={termLineClass(line)}>
                        {line === "" ? " " : line}
                    </div>
                ))
            )}
        </div>
    );
}

export function MainPane({
    projection,
    agent,
    paneText,
    selectedWorkspaceId,
    composingWorkspaceId,
    composerFocusSeq,
}: {
    projection: ShellProjection;
    agent: AgentSnapshot | null;
    paneText: string;
    selectedWorkspaceId: string | null;
    composingWorkspaceId: string | null;
    composerFocusSeq: number;
}) {
    const { t } = useI18n();
    const [input, setInput] = useState("");
    const [images, setImages] = useState<AttachedImage[]>([]);
    const [sending, setSending] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // compose 成功后自动聚焦 composer
    useEffect(() => {
        inputRef.current?.focus();
    }, [composerFocusSeq]);

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

    // pane 内容还很"空"（刚创建/无输出）→ Codex 式 hero，有真实输出后自动切回终端
    const trivialPane = paneText === "" || (agent.turn === 0 && paneText.split("\n").length < 3);

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

            {trivialPane ? (
                <div className="hero">
                    <div className="hero-q">
                        {t("main.heroTitle", { name: workspace?.label ?? agent.name })}
                    </div>
                    <div className="hero-sub">{t("main.heroSub", { agent: agent.name })}</div>
                </div>
            ) : (
                <Terminal text={paneText} />
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
                    <input
                        ref={inputRef}
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
                            if (e.key === "Enter" && !e.shiftKey) send();
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
