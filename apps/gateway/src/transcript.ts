/**
 * Transcript 提取与降噪解析器（消融极简设计，去多余抽象）。
 *
 * 优先读取本地 Agent 原生持久化的结构化 JSONL（包含 Thinking、Tool Calls、Markdown 内容）；
 * 若无本地 Transcript，则通过 sanitizePaneText 剥离终端 Banner / 状态栏噪声。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ThreadRecord, ToolCallItem } from "@agent-cli-contact/contracts";

/** Claude Code 的项目目录 slug */
function claudeProjectSlug(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

/** 剥离 USER_REQUEST 等外层 XML 标签，还原用户真实输入 */
function cleanPromptContent(raw: string): string {
    const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    if (match && match[1]) return match[1].trim();
    return raw.trim();
}

function appendAssistantRecord(
    records: ThreadRecord[],
    newRec: { id?: string; text: string; thinking?: string; toolCalls?: ToolCallItem[]; at: number },
): void {
    const last = records[records.length - 1];
    if (last && last.role === "assistant") {
        if (newRec.text) {
            last.text = last.text ? `${last.text}\n\n${newRec.text}` : newRec.text;
        }
        if (newRec.thinking) {
            last.thinking = last.thinking ? `${last.thinking}\n${newRec.thinking}` : newRec.thinking;
        }
        if (newRec.toolCalls && newRec.toolCalls.length > 0) {
            last.toolCalls = [...(last.toolCalls ?? []), ...newRec.toolCalls];
        }
        last.at = newRec.at;
    } else {
        records.push({
            id: newRec.id,
            role: "assistant",
            text: newRec.text,
            thinking: newRec.thinking,
            toolCalls: newRec.toolCalls,
            at: newRec.at,
        });
    }
}

/** 读取 Antigravity CLI (agy) 的本地 transcript.jsonl */
function parseAgyTranscript(sessionId: string): ThreadRecord[] | null {
    const file = path.join(
        os.homedir(),
        ".gemini",
        "antigravity-cli",
        "brain",
        sessionId,
        ".system_generated",
        "logs",
        "transcript.jsonl",
    );
    if (!fs.existsSync(file)) return null;

    try {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        const records: ThreadRecord[] = [];

        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                const at = item.created_at ? Date.parse(item.created_at) : Date.now();

                if (item.type === "USER_INPUT") {
                    const text = cleanPromptContent(String(item.content ?? ""));
                    if (text) {
                        records.push({
                            id: `agy-u-${item.step_index ?? records.length}`,
                            role: "user",
                            text,
                            at,
                        });
                    }
                } else if (item.type === "PLANNER_RESPONSE") {
                    const text = String(item.content ?? "").trim();
                    const thinking = item.thinking ? String(item.thinking).trim() : undefined;
                    let toolCalls: ToolCallItem[] | undefined;

                    if (Array.isArray(item.tool_calls) && item.tool_calls.length > 0) {
                        toolCalls = item.tool_calls.map((tc: any) => {
                            const name = String(tc.name ?? "tool");
                            const summary =
                                tc.args?.toolSummary ||
                                tc.args?.toolAction ||
                                tc.args?.command ||
                                tc.args?.AbsolutePath ||
                                name;
                            return {
                                name,
                                summary: typeof summary === "string" ? summary.replace(/^"|"$/g, "") : name,
                                status: "done",
                            };
                        });
                    }

                    if (text || thinking || (toolCalls && toolCalls.length > 0)) {
                        appendAssistantRecord(records, {
                            id: `agy-a-${item.step_index ?? records.length}`,
                            text,
                            thinking,
                            toolCalls,
                            at,
                        });
                    }
                }
            } catch {
                // 跳过单行损坏
            }
        }
        return records.length > 0 ? records : null;
    } catch {
        return null;
    }
}

/** 读取 Claude Code 的本地 JSONL 会话记录 */
function parseClaudeTranscript(cwd: string, sessionId: string): ThreadRecord[] | null {
    const file = path.join(
        os.homedir(),
        ".claude",
        "projects",
        claudeProjectSlug(cwd),
        `${sessionId}.jsonl`,
    );
    if (!fs.existsSync(file)) return null;

    try {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n").filter((l) => l.trim().length > 0);
        const records: ThreadRecord[] = [];

        for (let i = 0; i < lines.length; i++) {
            const rawLine = lines[i];
            if (!rawLine) continue;
            try {
                const item = JSON.parse(rawLine);
                const at = item.timestamp ? Date.parse(item.timestamp) : Date.now();

                if (item.type === "user" && item.message?.content) {
                    let text = "";
                    if (typeof item.message.content === "string") {
                        text = item.message.content;
                    } else if (Array.isArray(item.message.content)) {
                        text = item.message.content
                            .map((c: any) => (typeof c === "string" ? c : c.text ?? ""))
                            .join("\n");
                    }
                    text = cleanPromptContent(text);
                    if (text) {
                        records.push({
                            id: item.uuid ?? `claude-u-${i}`,
                            role: "user",
                            text,
                            at,
                        });
                    }
                } else if (item.type === "assistant" && item.message?.content) {
                    let text = "";
                    let thinking: string | undefined;
                    const toolCalls: ToolCallItem[] = [];

                    if (Array.isArray(item.message.content)) {
                        for (const block of item.message.content) {
                            if (block.type === "text" && block.text) {
                                text += (text ? "\n\n" : "") + block.text;
                            } else if (block.type === "thinking" && block.thinking) {
                                thinking = (thinking ? thinking + "\n" : "") + block.thinking;
                            } else if (block.type === "tool_use") {
                                const name = String(block.name ?? "tool");
                                const summary =
                                    block.input?.description ||
                                    block.input?.command ||
                                    block.input?.file_path ||
                                    block.input?.pattern ||
                                    name;
                                toolCalls.push({
                                    name,
                                    summary: String(summary),
                                    status: "done",
                                });
                            }
                        }
                    } else if (typeof item.message.content === "string") {
                        text = item.message.content;
                    }

                    if (text || thinking || toolCalls.length > 0) {
                        appendAssistantRecord(records, {
                            id: item.uuid ?? `claude-a-${i}`,
                            text: text.trim(),
                            thinking: thinking?.trim(),
                            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                            at,
                        });
                    }
                }
            } catch {
                // 跳过单行损坏
            }
        }
        return records.length > 0 ? records : null;
    } catch {
        return null;
    }
}

/**
 * 读取指定 Agent 的结构化 Transcript。
 */
export function readAgentTranscript(
    provider: string,
    sessionId?: string | null,
    cwd?: string | null,
): ThreadRecord[] | null {
    if (!sessionId) return null;
    const p = provider.toLowerCase();
    if (p.includes("antigravity") || p.includes("agy")) {
        return parseAgyTranscript(sessionId);
    }
    if (p.includes("claude") && cwd) {
        return parseClaudeTranscript(cwd, sessionId);
    }
    return null;
}

/**
 * 终端屏幕文本降噪清洗（消融降噪 Fallback）：
 * 剥离已知 CLI 的 ASCII Logo 字符画、版本/环境信息头、命令行回显以及底部快捷键提示行。
 */
export function sanitizePaneText(rawText: string): string {
    if (!rawText) return "";
    let lines = rawText.split("\n");

    // 1. 裁剪开头的 ASCII Banner 字符画与版本头部（如 Antigravity CLI 1.2.3、Claude Code 欢迎头）
    let startIdx = 0;
    for (let i = 0; i < Math.min(lines.length, 30); i++) {
        const rawLine = lines[i];
        if (!rawLine) continue;
        const line = rawLine.trim();
        // 如果包含明显的分割线 ─── 或常见 prompt 标识，则之前的全部是启动 banner
        if (/^─{5,}/.test(line) || /^═{5,}/.test(line)) {
            startIdx = i + 1;
            break;
        }
        if (
            line.includes("Antigravity CLI") ||
            line.includes("Claude Code") ||
            line.includes("▄▀▀▄") ||
            line.includes("▀▀▀▀") ||
            line.startsWith("? for shortcuts")
        ) {
            startIdx = i + 1;
        }
    }
    lines = lines.slice(startIdx);

    // 2. 裁剪底部的终端快捷键状态栏（如 '? for shortcuts'、'esc to cancel'、'manual mode on'）
    while (lines.length > 0) {
        const rawLast = lines[lines.length - 1];
        if (!rawLast) {
            lines.pop();
            continue;
        }
        const last = rawLast.trim();
        if (
            !last ||
            last.includes("? for shortcuts") ||
            last.includes("esc to cancel") ||
            last.includes("manual mode on") ||
            last.includes("Update available!") ||
            /^─{5,}/.test(last) ||
            /^═{5,}/.test(last)
        ) {
            lines.pop();
        } else {
            break;
        }
    }

    return lines.join("\n").trim();
}
