/**
 * 从 provider 的会话文件读取 agent 实际运行的模型（herdr 不上报模型）。
 * 目前支持 Claude Code：herdr agent_session 给出 session id，
 * 会话记录在 ~/.claude/projects/<cwd-slug>/<session-id>.jsonl，
 * 每条 assistant 消息带 "model" 字段——读文件尾部取最后出现的。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TAIL_BYTES = 64 * 1024;

/** Claude Code 的项目目录 slug：cwd 中非 [a-zA-Z0-9-] 的字符替换为 '-' */
function claudeProjectSlug(cwd: string): string {
    return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

/** 归一化到 capability 表的模型 id；未识别时返回原始 id */
export function normalizeClaudeModel(raw: string): string {
    if (raw.includes("fable")) return "claude-fable-5";
    if (raw.includes("opus")) return "claude-opus-5";
    if (raw.includes("sonnet")) return "claude-sonnet-5";
    if (raw.includes("haiku")) return "claude-haiku-4-5";
    return raw;
}

/** 读 Claude 会话文件尾部，取最后一次出现的 "model"；读不到返回 null */
export function detectClaudeModel(cwd: string, sessionId: string): string | null {
    try {
        const file = path.join(
            os.homedir(),
            ".claude",
            "projects",
            claudeProjectSlug(cwd),
            `${sessionId}.jsonl`,
        );
        const stat = fs.statSync(file);
        const start = Math.max(0, stat.size - TAIL_BYTES);
        const fd = fs.openSync(file, "r");
        const buf = Buffer.alloc(stat.size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        fs.closeSync(fd);
        const text = buf.toString("utf8");
        const matches = text.match(/"model":"([^"]+)"/g);
        if (!matches?.length) return null;
        const last = matches[matches.length - 1]!.slice(9, -1);
        // 过滤 synthetic 等占位值
        if (!last.startsWith("claude")) return null;
        return normalizeClaudeModel(last);
    } catch {
        return null;
    }
}
