import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { zh } from "./zh";
import { en } from "./en";

export type Locale = "zh" | "en";
export type MsgKey = keyof typeof zh;
export type TParams = Record<string, string | number>;

const STORAGE_KEY = "wb-locale";
const dicts: Record<Locale, Record<MsgKey, string>> = { zh, en };

function loadLocale(): Locale {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v === "en" || v === "zh" ? v : "zh";
    } catch {
        return "zh";
    }
}

// 模块级 locale 状态：非 React 模块（ws.ts / util.ts）也能取到当前语言
let locale: Locale = loadLocale();
const listeners = new Set<() => void>();

function getLocale(): Locale {
    return locale;
}

export function setLocale(next: Locale): void {
    if (next === locale) return;
    locale = next;
    try {
        localStorage.setItem(STORAGE_KEY, next);
    } catch {
        // localStorage 不可用时静默降级
    }
    for (const l of listeners) l();
}

function subscribeLocale(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** 翻译：缺键时回退为键名本身；支持 {name} 占位插值 */
export function t(key: MsgKey, params?: TParams): string {
    const raw: string = dicts[locale][key] ?? key;
    if (!params) return raw;
    return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
    );
}

export interface I18nValue {
    t: typeof t;
    locale: Locale;
    setLocale: (next: Locale) => void;
}

const I18nContext = createContext<I18nValue>({ t, locale, setLocale });

export function I18nProvider({ children }: { children: ReactNode }) {
    const current = useSyncExternalStore(subscribeLocale, getLocale);
    const value = useMemo<I18nValue>(() => ({ t, locale: current, setLocale }), [current]);
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
    return useContext(I18nContext);
}
