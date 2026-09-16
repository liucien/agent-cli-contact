/**
 * herdr 环境检测与安装引导动作。
 * 检测经 /bin/sh -lc（登录 shell 全量 PATH，打包 sidecar 下同样可靠）；
 * `herdr server`（无子命令）即无头前台运行，detached spawn 后台常驻。
 */
import { spawn, execFile } from "node:child_process";
import type { HerdrEnv } from "@agent-cli-contact/contracts";
import { socketAvailable } from "@agent-cli-contact/herdr-client";

function shLookup(cmd: string): Promise<string | null> {
    return new Promise((resolve) => {
        execFile("/bin/sh", ["-lc", cmd], { timeout: 8000 }, (err, stdout) => {
            resolve(err ? null : stdout.trim() || null);
        });
    });
}

export async function detectHerdr(): Promise<HerdrEnv> {
    const [path, brew] = await Promise.all([
        shLookup("command -v herdr"),
        shLookup("command -v brew"),
    ]);
    if (!path) return { status: "not-installed", brewAvailable: !!brew };
    const versionRaw = await shLookup("herdr --version"); // e.g. "herdr 0.8.0"
    const version = versionRaw?.match(/[\d.]+/)?.[0];
    return {
        status: socketAvailable() ? "ready" : "not-running",
        version,
        path,
        brewAvailable: !!brew,
    };
}

/** brew install herdr，stdout/stderr 按行回调（引导页日志区） */
export function installHerdr(onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn("/bin/sh", ["-lc", "brew install herdr"], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let buf = "";
        const feed = (d: Buffer) => {
            buf += d.toString();
            let idx: number;
            while ((idx = buf.indexOf("\n")) >= 0) {
                onLine(buf.slice(0, idx));
                buf = buf.slice(idx + 1);
            }
        };
        child.stdout!.on("data", feed);
        child.stderr!.on("data", feed);
        child.on("error", (err) => reject(new Error(`brew 启动失败: ${err.message}`)));
        child.on("exit", (code) => {
            if (buf.trim()) onLine(buf);
            if (code === 0) resolve();
            else reject(new Error(`brew install herdr 退出码 ${code}`));
        });
    });
}

/** 后台常驻启动 herdr server（socket 就绪由外层轮询确认）。
 *  清洗 CLAUDE_CODE_* 等继承变量：否则其中启动的 claude agent 会关闭
 *  transcript 等行为（"inherited CLAUDE_CODE_…" 警告）。 */
export function startHerdrServer(herdrPath: string): void {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
        if (v === undefined) continue;
        if (k.startsWith("CLAUDE_CODE") || k === "CLAUDECODE" || k.startsWith("ANTHROPIC_")) continue;
        env[k] = v;
    }
    const child = spawn(herdrPath, ["server"], { detached: true, stdio: "ignore", env });
    child.unref();
}
