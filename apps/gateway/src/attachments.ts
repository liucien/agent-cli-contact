/**
 * prompt 附图落盘：base64 → ~/.agent-cli-contact/attachments/<uuid>.<ext>，
 * 路径附进 prompt 文本，pane 内 CLI（Claude Code 等）按路径读图。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PromptImage } from "@agent-cli-contact/contracts";

const ATTACH_DIR = path.join(os.homedir(), ".agent-cli-contact", "attachments");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_IMAGES = 4;
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

/** 落盘并返回绝对路径列表 */
export function saveImages(images: PromptImage[]): string[] {
    if (images.length > MAX_IMAGES) throw new Error(`一次最多发送 ${MAX_IMAGES} 张图片`);
    fs.mkdirSync(ATTACH_DIR, { recursive: true });
    const paths: string[] = [];
    for (const img of images) {
        const ext = path.extname(img.name).toLowerCase() || ".png";
        if (!ALLOWED_EXT.has(ext)) throw new Error(`不支持的图片格式: ${ext}`);
        const buf = Buffer.from(img.dataBase64, "base64");
        if (buf.length === 0) throw new Error(`图片内容为空: ${img.name}`);
        if (buf.length > MAX_IMAGE_BYTES) throw new Error(`图片超过 10MB: ${img.name}`);
        const file = path.join(ATTACH_DIR, `${randomUUID()}${ext}`);
        fs.writeFileSync(file, buf);
        paths.push(file);
    }
    return paths;
}

/** 把图片路径拼进 prompt 文本 */
export function withImagePaths(text: string, paths: string[]): string {
    if (!paths.length) return text;
    return `${text}\n\n[附图，请读取以下图片文件]\n${paths.join("\n")}`;
}
