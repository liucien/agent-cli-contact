/**
 * 把 herdr 推送的 Claude Code TUI 屏幕文本解析成结构化 block：
 * 普通文本 / diff 片段 / 尾部交互菜单。解析全程容错——解析不了的都退回 text block。
 */

export type DiffLineKind = "add" | "del" | "ctx";

export interface MenuOption {
    num: number;
    label: string;
    selected: boolean;
}

export type Block =
    | { type: "text"; lines: string[] }
    | { type: "diff"; lines: { kind: DiffLineKind; text: string }[] }
    | { type: "menu"; question: string | null; options: MenuOption[]; hint: string | null };

const OPTION_RE = /^(\s*)(❯)?\s*(\d+)\.\s+(.*)$/;
/** 注意：不含 shift+tab —— 它常出现在选项 label 内部，真正的 hint 是 "Esc to …" 这类 */
const HINT_RE = /esc to|tab to|enter to/i;
/** TUI 水平分隔线：仅由 ─ / ━ / - 重复组成 */
const RULE_RE = /^\s*[─━-]{3,}\s*$/;
const DIFF_ADD_RE = /^(?:\s*\d+\s*\+|\s*\+\s)/;
const DIFF_DEL_RE = /^(?:\s*\d+\s*-|\s*-\s)/;
const DIFF_CTX_RE = /^\s*\d+\s/;
/** 菜单只在屏幕尾部生效的窗口（非空行数） */
const MENU_TAIL_WINDOW = 18;

function indentOf(line: string): number {
    const m = line.match(/^\s*/);
    return m ? m[0].length : 0;
}

interface MenuScan {
    /** 菜单块消费的首行（含 question） */
    start: number;
    /** 菜单块消费的末行（含 hint） */
    end: number;
    menu: Extract<Block, { type: "menu" }>;
}

/** 找屏幕尾部唯一的交互菜单；scrollback 里更早的菜单一律当普通文本 */
function scanTailMenu(lines: string[]): MenuScan | null {
    let best: { firstOpt: number; lastOpt: number; options: MenuOption[] } | null = null;

    let i = 0;
    while (i < lines.length) {
        const first = (lines[i] ?? "").match(OPTION_RE);
        if (!first || Number(first[3]) !== 1) {
            i++;
            continue;
        }
        // 以 "1." 起始的选项串；编号必须逐个递增。
        // 折行判定基准：编号所在列（❯ 前缀不算），比它更深的缩进都是上一选项的折行
        const numCol = (lines[i] ?? "").search(/\d/);
        const options: MenuOption[] = [
            { num: 1, label: (first[4] ?? "").trim(), selected: first[2] === "❯" },
        ];
        let expected = 2;
        let lastOpt = i;
        let j = i + 1;
        while (j < lines.length) {
            const line = lines[j] ?? "";
            const om = line.match(OPTION_RE);
            if (om && Number(om[3]) === expected) {
                options.push({
                    num: expected,
                    label: (om[4] ?? "").trim(),
                    selected: om[2] === "❯",
                });
                expected++;
                lastOpt = j;
                j++;
                continue;
            }
            // 折行优先于 hint：比编号列更深缩进的非空行始终归上一选项
            // （即使它长得像 hint，如 label 里的 "(shift+tab)"）
            if (!om && line.trim() !== "" && indentOf(line) > numCol) {
                const prev = options[options.length - 1];
                if (prev) prev.label += ` ${line.trim()}`;
                lastOpt = j;
                j++;
                continue;
            }
            // 其余（基准缩进处的 hint、空行、普通输出）→ 选项串结束，hint 由后续扫描处理
            break;
        }
        if (options.length >= 2) best = { firstOpt: i, lastOpt, options }; // 保留最靠后的一组
        i = Math.max(j, i + 1);
    }
    if (!best) return null;

    // 尾部判定：首个选项行必须落在最后 N 个非空行内
    const nonEmptyIdx: number[] = [];
    for (let k = 0; k < lines.length; k++) {
        if ((lines[k] ?? "").trim() !== "") nonEmptyIdx.push(k);
    }
    const cutoff =
        nonEmptyIdx.length > MENU_TAIL_WINDOW
            ? (nonEmptyIdx[nonEmptyIdx.length - MENU_TAIL_WINDOW] ?? 0)
            : 0;
    if (best.firstOpt < cutoff) return null;

    // hint：选项后第一个非空行（若匹配提示词）
    let end = best.lastOpt;
    let hint: string | null = null;
    for (let k = best.lastOpt + 1; k < lines.length; k++) {
        const tline = (lines[k] ?? "").trim();
        if (tline === "") continue;
        if (HINT_RE.test(tline)) {
            hint = tline;
            end = k;
        }
        break;
    }

    // question：首个选项上方最近的非空行（分隔线则视为无 question）
    let start = best.firstOpt;
    let question: string | null = null;
    for (let k = best.firstOpt - 1; k >= 0; k--) {
        const raw = lines[k] ?? "";
        if (raw.trim() === "") continue;
        if (!RULE_RE.test(raw)) {
            question = raw.trim();
            start = k;
        }
        break;
    }

    return {
        start,
        end,
        menu: { type: "menu", question, options: best.options, hint },
    };
}

/** @param withMenu 关闭时不识别尾部菜单（历史帧渲染为纯文本，不可交互） */
export function parseScreen(text: string, withMenu = true): Block[] {
    const lines = text.length > 0 ? text.split("\n") : [];
    const menuScan = withMenu ? scanTailMenu(lines) : null;
    const blocks: Block[] = [];
    let textBuf: string[] = [];

    const flushText = () => {
        // 去掉块首尾的空行，避免分隔线剥离后留下大段空白
        while (textBuf.length > 0 && (textBuf[0] ?? "").trim() === "") textBuf.shift();
        while (textBuf.length > 0 && (textBuf[textBuf.length - 1] ?? "").trim() === "")
            textBuf.pop();
        if (textBuf.length > 0) blocks.push({ type: "text", lines: textBuf });
        textBuf = [];
    };

    let i = 0;
    while (i < lines.length) {
        if (menuScan && i === menuScan.start) {
            flushText();
            blocks.push(menuScan.menu);
            i = menuScan.end + 1;
            continue;
        }
        const line = lines[i] ?? "";
        // 分隔线：作为块边界剥离
        if (RULE_RE.test(line) && line.trim() !== "") {
            flushText();
            i++;
            continue;
        }
        // diff run：≥2 行 +/-，中间夹杂的纯行号行是 ctx
        if (DIFF_ADD_RE.test(line) || DIFF_DEL_RE.test(line)) {
            const run: { kind: DiffLineKind; text: string }[] = [];
            let changes = 0;
            let j = i;
            const limit = menuScan && menuScan.start > i ? menuScan.start : lines.length;
            while (j < limit) {
                const l = lines[j] ?? "";
                if (DIFF_ADD_RE.test(l)) {
                    run.push({ kind: "add", text: l });
                    changes++;
                } else if (DIFF_DEL_RE.test(l)) {
                    run.push({ kind: "del", text: l });
                    changes++;
                } else if (DIFF_CTX_RE.test(l)) {
                    run.push({ kind: "ctx", text: l });
                } else {
                    break;
                }
                j++;
            }
            if (changes >= 2) {
                flushText();
                blocks.push({ type: "diff", lines: run });
                i = j;
                continue;
            }
        }
        textBuf.push(line);
        i++;
    }
    flushText();
    return blocks;
}
