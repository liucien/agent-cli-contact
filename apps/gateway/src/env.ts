/**
 * 环境与路径工具：
 * 在 macOS GUI 打包启动模式下（launchd 极简 PATH），自动加载登录 Shell 全量 PATH，
 * 并兜底补齐 Homebrew、Cargo 等标准安装目录，保证 sidecar 与外部命令可用。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getShell(): string {
    if (process.env.SHELL) return process.env.SHELL;
    try {
        const userShell = os.userInfo().shell;
        if (userShell) return userShell;
    } catch {}
    return process.platform === "darwin" ? "/bin/zsh" : "/bin/sh";
}

export function standardBinaryDirs(): string[] {
    const home = os.homedir();
    const dirs = [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        path.join(home, ".local", "bin"),
        path.join(home, ".cargo", "bin"),
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ];
    return dirs.filter((d) => {
        try {
            return fs.existsSync(d);
        } catch {
            return false;
        }
    });
}

/** 修复当前进程的 process.env.PATH */
export function fixPath(): void {
    if (process.platform !== "darwin" && process.platform !== "linux") {
        return;
    }

    const currentPaths = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    const collectedPaths: string[] = [];

    // 1. 尝试从用户 login shell 抽取全量 PATH
    const shell = getShell();
    try {
        const out = execFileSync(shell, ["-lc", 'echo -n "__ENV_PATH__${PATH}__ENV_PATH__"'], {
            encoding: "utf8",
            timeout: 4000,
            stdio: ["ignore", "pipe", "ignore"],
            env: {
                ...process.env,
                PATH: process.env.PATH || "/usr/bin:/bin:/usr/sbin:/sbin",
            },
        });
        const match = out.match(/__ENV_PATH__([\s\S]*?)__ENV_PATH__/);
        if (match && match[1]) {
            const shellPaths = match[1].trim().split(path.delimiter).filter(Boolean);
            collectedPaths.push(...shellPaths);
        }
    } catch (err) {
        console.warn("[gateway] 尝试从 login shell 获取 PATH 失败:", err);
    }

    // 2. 结合标准路径与原环境变量 PATH
    collectedPaths.push(...standardBinaryDirs());
    collectedPaths.push(...currentPaths);

    // 3. 去重写回 process.env.PATH
    const finalPaths = Array.from(new Set(collectedPaths));
    process.env.PATH = finalPaths.join(path.delimiter);
    if (!process.env.SHELL) {
        process.env.SHELL = shell;
    }
}

/** 查找指定可执行文件的绝对路径 */
export function findExecutable(name: string): string | null {
    const searchDirs = [
        ...(process.env.PATH || "").split(path.delimiter).filter(Boolean),
        ...standardBinaryDirs(),
    ];
    const checked = new Set<string>();

    for (const dir of searchDirs) {
        if (checked.has(dir)) continue;
        checked.add(dir);
        const candidate = path.join(dir, name);
        try {
            if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                fs.accessSync(candidate, fs.constants.X_OK);
                return candidate;
            }
        } catch {}
    }
    return null;
}
