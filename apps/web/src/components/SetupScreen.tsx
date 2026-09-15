import { useEffect, useRef, useState } from "react";
import type { HerdrEnv } from "@agent-cli-contact/contracts";
import { call } from "../store";
import { useI18n } from "../i18n";

const INSTALL_CMD = "brew install herdr";

/** herdr 环境引导：未安装/未运行时的全屏 onboarding，就绪后自动进入工作台 */
export function SetupScreen({ herdr, log }: { herdr: HerdrEnv; log: string[] }) {
    const { t } = useI18n();
    const [copied, setCopied] = useState(false);
    const [installing, setInstalling] = useState(false);
    const logRef = useRef<HTMLDivElement>(null);

    // 环境状态变化（安装完成/重新检测）时重置本地安装标记
    useEffect(() => {
        setInstalling(false);
    }, [herdr.status]);

    // 安装日志自动滚动到底部
    useEffect(() => {
        const el = logRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [log.length]);

    const copy = () => {
        void navigator.clipboard.writeText(INSTALL_CMD).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const install = () => {
        setInstalling(true);
        call("setup.install").catch(() => setInstalling(false));
    };

    const start = () => {
        call("setup.start").catch(() => undefined);
    };

    const step1Done = herdr.status !== "not-installed";
    const starting = herdr.status === "starting";

    return (
        <div className="setup-wrap">
            <div className="setup-card">
                <div className="setup-title">{t("setup.title")}</div>
                <div className="setup-sub">{t("setup.subtitle")}</div>

                <div className={`setup-step ${step1Done ? "done" : "active"}`}>
                    <span className="num">{step1Done ? "✓" : "1"}</span>
                    <div className="body">
                        <div className="ttl">{t("setup.step1")}</div>
                        {step1Done ? (
                            <div className="done-line">
                                herdr v{herdr.version ?? "?"}
                                {herdr.path && <span className="path"> · {herdr.path}</span>}
                            </div>
                        ) : (
                            <>
                                <div className="setup-cmd mono">
                                    <span>{INSTALL_CMD}</span>
                                    <button className="chip" onClick={copy}>
                                        {copied ? t("setup.copied") : t("setup.copy")}
                                    </button>
                                </div>
                                {herdr.brewAvailable ? (
                                    <div className="setup-actions">
                                        <button
                                            className="btn pri"
                                            disabled={installing}
                                            onClick={install}
                                        >
                                            {installing
                                                ? t("setup.installing")
                                                : t("setup.autoInstall")}
                                        </button>
                                    </div>
                                ) : (
                                    <div className="setup-note">
                                        {t("setup.noBrewA")}{" "}
                                        <a href="https://brew.sh" target="_blank" rel="noreferrer">
                                            brew.sh
                                        </a>{" "}
                                        {t("setup.noBrewB")}{" "}
                                        <a
                                            href="https://herdr.dev"
                                            target="_blank"
                                            rel="noreferrer"
                                        >
                                            herdr.dev
                                        </a>{" "}
                                        {t("setup.noBrewC")}
                                    </div>
                                )}
                                {(installing || log.length > 0) && (
                                    <div className="setup-log mono" ref={logRef}>
                                        {log.map((line, i) => (
                                            <div key={i}>{line}</div>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className={`setup-step ${step1Done ? "active" : "pending"}`}>
                    <span className="num">2</span>
                    <div className="body">
                        <div className="ttl">{t("setup.step2")}</div>
                        <div className="setup-note">{t("setup.startCaption")}</div>
                        {step1Done && (
                            <div className="setup-actions">
                                <button className="btn pri" disabled={starting} onClick={start}>
                                    {starting ? t("setup.starting") : t("setup.startBtn")}
                                </button>
                            </div>
                        )}
                    </div>
                </div>

                <div className="setup-foot">
                    <button className="lnk" onClick={() => void call("setup.recheck")}>
                        {t("setup.recheck")}
                    </button>
                    <span>{t("setup.autoNote")}</span>
                </div>
            </div>
        </div>
    );
}
