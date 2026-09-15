/**
 * 在 gateway 宿主机上用外部编辑器打开项目目录。
 * 经 `/bin/sh -lc` 执行，登录 shell 会加载完整 PATH——打包成 .app sidecar
 * 后（launchd 的精简 PATH 下）`code` / `cursor` 等命令仍可解析。
 */
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

export function expandHome(p: string): string {
    return p.startsWith("~") ? path.join(os.homedir(), p.slice(1)) : p;
}

export function openInEditor(editorCommand: string, dir: string): Promise<void> {
    const target = expandHome(dir);
    const cmd = `${editorCommand} "${target.replaceAll('"', '\\"')}"`;
    return new Promise((resolve, reject) => {
        const child = spawn("/bin/sh", ["-lc", cmd], { stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("error", (err) => reject(new Error(`编辑器启动失败: ${err.message}`)));
        // 编辑器启动命令（code/cursor/open …）应快速退出；1.5s 内非零退出视为失败
        const timer = setTimeout(() => resolve(), 1500);
        child.on("exit", (code) => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else
                reject(
                    new Error(
                        `编辑器命令退出码 ${code}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ""}`,
                    ),
                );
        });
    });
}
