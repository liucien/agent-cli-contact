/**
 * herdr 环境检测与安装引导动作。
 * 检测经 /bin/sh -lc（登录 shell 全量 PATH，打包 sidecar 下同样可靠）；
 * `herdr server`（无子命令）即无头前台运行，detached spawn 后台常驻。
 */
import { spawn, execFile } from "node:child_process";
import type { HerdrEnv } from "@agent-cli-contact/contracts";
import { socketAvailable } from "@agent-cli-contact/herdr-client";
import { findExecutable, getShell } from "./env";

function shLookup(cmd: string): Promise<string | null> {
    const shell = getShell();
    return new Promise((resolve) => {
        execFile(shell, ["-lc", cmd], { timeout: 8000, env: process.env }, (err, stdout) => {
            resolve(err ? null : stdout.trim() || null);
        });
    });
}

function getVersionDirect(binPath: string): Promise<string | null> {
    return new Promise((resolve) => {
        execFile(binPath, ["--version"], { timeout: 4000, env: process.env }, (err, stdout) => {
            if (err || !stdout) return resolve(null);
            const m = stdout.match(/[\d.]+/);
            resolve(m ? m[0] : null);
        });
    });
}

interface BinaryCache {
    herdrPath: string | null;
    version?: string;
    brewAvailable: boolean;
}

let cachedBinary: BinaryCache | null = null;
let probePromise: Promise<BinaryCache> | null = null;

/** 清空缓存，强制下一次 detectHerdr 进行单次全量查询 */
export function invalidateHerdrCache(): void {
    cachedBinary = null;
}

/** 单次查询：使用 login shell 查询 command -v herdr 与 herdr status --json */
async function probeBinary(): Promise<BinaryCache> {
    // 1. 查找 herdr 路径：优先系统 command -v，兜底使用 findExecutable
    let herdrPath = await shLookup("command -v herdr");
    if (!herdrPath) {
        herdrPath = findExecutable("herdr");
    }

    // 2. 查找 brew 路径
    let brewPath = await shLookup("command -v brew");
    if (!brewPath) {
        brewPath = findExecutable("brew");
    }

    // 3. 提取版本信息：若 herdr 存在，优先尝试 herdr status --json
    let version: string | undefined;
    if (herdrPath) {
        try {
            const jsonOut = await shLookup(`${herdrPath} status --json`);
            if (jsonOut) {
                const parsed = JSON.parse(jsonOut);
                if (parsed?.client?.version) {
                    version = parsed.client.version;
                }
                if (parsed?.client?.binary && typeof parsed.client.binary === "string") {
                    herdrPath = parsed.client.binary;
                }
            }
        } catch {}

        if (!version && herdrPath) {
            const v = await getVersionDirect(herdrPath);
            if (v) version = v;
        }
    }

    const info: BinaryCache = {
        herdrPath: herdrPath || null,
        version,
        brewAvailable: !!brewPath,
    };
    cachedBinary = info;
    return info;
}

export async function detectHerdr(forceRefresh = false): Promise<HerdrEnv> {
    if (forceRefresh) {
        cachedBinary = null;
    }

    // 若无缓存，启动单次探测（并发防重入）
    if (!cachedBinary) {
        if (!probePromise) {
            probePromise = probeBinary().finally(() => {
                probePromise = null;
            });
        }
        await probePromise;
    }

    const info = cachedBinary!;
    const isSocketReady = socketAvailable();

    // 如果未找到 herdr 二进制，但 socket 可用（外部刚启动），自动触发一次全量探测
    if (!info.herdrPath && isSocketReady) {
        invalidateHerdrCache();
        return detectHerdr(true);
    }

    // 未安装判定
    if (!info.herdrPath && !isSocketReady) {
        return {
            status: "not-installed",
            brewAvailable: info.brewAvailable,
        };
    }

    return {
        status: isSocketReady ? "ready" : "not-running",
        version: info.version,
        path: info.herdrPath ?? undefined,
        brewAvailable: info.brewAvailable,
    };
}

/** brew install herdr，stdout/stderr 按行回调（引导页日志区） */
export function installHerdr(onLine: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const brewPath = findExecutable("brew") || "brew";
        const child = spawn(brewPath, ["install", "herdr"], {
            env: process.env,
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
            invalidateHerdrCache();
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
        if (k.startsWith("CLAUDE_CODE") || k === "CLAUDECODE" || k.startsWith("ANTHROPIC_"))
            continue;
        env[k] = v;
    }
    const child = spawn(herdrPath, ["server"], { detached: true, stdio: "ignore", env });
    child.unref();
}
