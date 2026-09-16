/**
 * Gateway 入口 —— herdr 的 GUI 数据支撑层（薄中间层）。
 * 启动即做 herdr 环境检测并持续轮询：未安装/未运行 → 投影只带 HerdrEnv，
 * 前端显示安装引导；socket 就绪 → 建立运行时服务束并接管真实 pane。
 */
import type { ConfigPreset, GatewaySettings, HerdrEnv } from "@agent-cli-contact/contracts";
import { HerdrRuntime } from "./herdrRuntime.js";
import { MeshRelay } from "./mesh.js";
import { Scheduler, type ScheduleDef } from "./scheduler.js";
import { ConfigService } from "./configService.js";
import { ThreadLog } from "./threadLog.js";
import { GatewayServer, type RuntimeServices } from "./server.js";
import { loadState, saveState, type PersistedState } from "./store.js";
import { detectHerdr, installHerdr, startHerdrServer } from "./setup.js";
import { fixPath } from "./env.js";

const DETECT_INTERVAL_MS = 2000;
/** setup.start 后，socket 出现前的「启动中」宽限期 */
const STARTING_GRACE_MS = 20000;

async function main(): Promise<void> {
    fixPath();
    const persisted = loadState();

    const presets: ConfigPreset[] = persisted?.presets ?? [
        {
            id: "preset-default",
            name: "默认开发",
            config: {
                model: "claude-fable-5",
                reasoning: "high",
                contextWindow: "1m",
                permissionMode: "full",
            },
        },
        {
            id: "preset-review",
            name: "安全评审 · Sonnet · Ask",
            config: {
                model: "claude-sonnet-5",
                reasoning: "medium",
                contextWindow: "200k",
                permissionMode: "ask",
            },
        },
        {
            id: "preset-night",
            name: "夜间无人值守 · Plan · 限速",
            config: {
                model: "claude-sonnet-5",
                reasoning: "medium",
                contextWindow: "200k",
                permissionMode: "plan",
            },
        },
    ];
    const settings: GatewaySettings = persisted?.settings ?? { editorCommand: "code" };

    let services: RuntimeServices | null = null;
    let herdrEnv: HerdrEnv = { status: "not-installed", brewAvailable: false };
    let installing = false;
    let startRequestedAt = 0;
    let server: GatewayServer | null = null;

    const persist = () => {
        const s = services;
        const sched = s?.scheduler.persistable();
        const state: PersistedState = {
            meshMessages: s ? s.mesh.messages.slice(-200) : (persisted?.meshMessages ?? []),
            meshRules: s ? s.mesh.rules : (persisted?.meshRules ?? []),
            timeline: s ? s.mesh.timeline.slice(-500) : (persisted?.timeline ?? []),
            relayApproval: s ? s.mesh.relayApproval : (persisted?.relayApproval ?? true),
            presets,
            schedules: sched?.defs ?? (persisted?.schedules as ScheduleDef[]) ?? [],
            scheduleRuns: sched?.runs ?? persisted?.scheduleRuns ?? [],
            settings,
            threads: s ? s.threadLog.persistable() : persisted?.threads,
            agentConfigs: s ? s.runtime.configsSnapshot() : persisted?.agentConfigs,
        };
        saveState(state);
    };

    const onDirty = () => {
        persist();
        server?.broadcastShell();
    };
    const notify = (level: "info" | "warn", text: string) => server?.notify(level, text);

    async function connectHerdr(): Promise<void> {
        const runtime = new HerdrRuntime(persisted?.agentConfigs);
        try {
            await runtime.start();
        } catch (err) {
            runtime.stop();
            throw err;
        }
        const threadLog = new ThreadLog(runtime, persisted?.threads, onDirty);
        const mesh = new MeshRelay(runtime, {
            onDirty,
            notify,
            onInject: (to, text) => threadLog.user(to, text),
        });
        const scheduler = new Scheduler(mesh, onDirty);
        const configService = new ConfigService(runtime, notify);
        if (persisted) {
            mesh.messages = persisted.meshMessages ?? [];
            mesh.rules = persisted.meshRules ?? [];
            mesh.timeline = persisted.timeline ?? [];
            mesh.relayApproval = persisted.relayApproval ?? true;
            scheduler.load(
                (persisted.schedules as ScheduleDef[]) ?? [],
                persisted.scheduleRuns ?? [],
            );
        } else {
            scheduler.load([], []);
        }
        services = { runtime, mesh, scheduler, configService, threadLog };
        runtime.onChange(() => onDirty()); // 状态/配置变化：持久化（去抖）+ 广播

        // Full access 语义：blocked（权限确认菜单）时自动批准当前默认项
        runtime.onStatusChange((agentId, _from, to) => {
            if (to !== "blocked") return;
            const agent = runtime.getAgent(agentId);
            if (agent?.config.permissionMode !== "full") return;
            setTimeout(() => {
                const a = runtime.getAgent(agentId);
                if (a?.status !== "blocked") return;
                runtime.sendKeys(agentId, ["Enter"]).then(
                    () => notify("info", `${a.name}: Full access 已自动批准`),
                    () => {},
                );
            }, 800);
        });
        console.log("[gateway] 已连接 herdr socket，运行时服务就绪");
    }

    /** 环境检测 + 就绪时接管；返回投影是否需要广播 */
    async function tick(forceRefresh = false): Promise<void> {
        const before = JSON.stringify(herdrEnv);
        const env = await detectHerdr(forceRefresh);
        if (env.status === "ready" && !services) {
            try {
                await connectHerdr();
                herdrEnv = env;
            } catch (err) {
                console.warn("[gateway] herdr 连接失败:", err instanceof Error ? err.message : err);
                herdrEnv = { ...env, status: "not-running" };
            }
        } else if (
            !services &&
            env.status === "not-running" &&
            Date.now() - startRequestedAt < STARTING_GRACE_MS
        ) {
            herdrEnv = { ...env, status: "starting" };
        } else {
            herdrEnv = env;
            if (services && env.status !== "ready") {
                // herdr server 消失：运行时已失效，回到引导（就绪后 tick 会重建服务束）
                console.warn("[gateway] herdr socket 消失，回到引导状态");
                services.runtime.stop();
                services = null;
            }
        }
        if (JSON.stringify(herdrEnv) !== before) server?.broadcastShell();
    }

    server = new GatewayServer({
        getServices: () => services,
        getHerdrEnv: () => herdrEnv,
        presets,
        settings,
        onDirty,
        setup: {
            async install(onLine) {
                if (installing) throw new Error("安装已在进行中");
                if (!herdrEnv.brewAvailable) throw new Error("未检测到 Homebrew，无法自动安装");
                installing = true;
                try {
                    await installHerdr(onLine);
                } finally {
                    installing = false;
                }
                await tick(true);
            },
            async start() {
                const env = await detectHerdr();
                if (!env.path) throw new Error("herdr 未安装，请先完成安装步骤");
                startRequestedAt = Date.now();
                startHerdrServer(env.path);
                await tick();
            },
            recheck: () => tick(true),
        },
    });

    await tick();
    console.log(
        `[gateway] herdr 环境: ${herdrEnv.status}${herdrEnv.version ? ` v${herdrEnv.version}` : ""}`,
    );
    setInterval(() => void tick(), DETECT_INTERVAL_MS);

    process.on("SIGINT", () => {
        services?.scheduler.stop();
        server?.close();
        process.exit(0);
    });
}

// 薄中间层不应因 herdr 关闭瞬间的竞态而整体退出
process.on("unhandledRejection", (reason) => {
    console.warn("[gateway] unhandled rejection:", String(reason));
});

void main();
