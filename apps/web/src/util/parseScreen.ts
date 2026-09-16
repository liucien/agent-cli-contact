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

const OPTION_RE = /^(\s*)([❯>])?\s*(\d+)\.\s+(.*)$/;
/** 注意：真正的 hint 是 "Esc to …"、"tab Amend" 这类按键导航提示 */
const HINT_RE = /esc to|tab to|enter to|navigate|tab amend/i;
/** TUI 水平分隔线：仅由 ─ / ━ / - 重复组成 */
const RULE_RE = /^\s*[─━-]{3,}\s*$/;
const DIFF_ADD_RE = /^(?:\s*\d+\s*\+|\s*\+\s)/;
const DIFF_DEL_RE = /^(?:\s*\d+\s*-|\s*-\s)/;
const DIFF_CTX_RE = /^\s*\d+\s/;
/** 菜单只在屏幕尾部生效的窗口（非空行数） */
const MENU_TAIL_WINDOW = 25;

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
        const numCol = (lines[i] ?? "").search(/\d/);
        const options: MenuOption[] = [
            { num: 1, label: (first[4] ?? "").trim(), selected: Boolean(first[2]) },
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
                    selected: Boolean(om[2]),
                });
                expected++;
                lastOpt = j;
                j++;
                continue;
            }
            // 折行：不是 hint / 分隔线 / 空行，且（自身缩进深于编号列，或后续 1~3 行内有下一选项）
            if (!om && line.trim() !== "" && !HINT_RE.test(line) && !RULE_RE.test(line)) {
                let isWrap = indentOf(line) > numCol;
                if (!isWrap) {
                    for (let look = 1; look <= 3 && j + look < lines.length; look++) {
                        const nextM = (lines[j + look] ?? "").match(OPTION_RE);
                        if (nextM && Number(nextM[3]) === expected) {
                            isWrap = true;
                            break;
                        }
                    }
                }
                if (isWrap) {
                    const prev = options[options.length - 1];
                    if (prev) prev.label += ` ${line.trim()}`;
                    lastOpt = j;
                    j++;
                    continue;
                }
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

    // hint：选项后连续的提示行
    let end = best.lastOpt;
    const hintLines: string[] = [];
    for (let k = best.lastOpt + 1; k < lines.length; k++) {
        const tline = (lines[k] ?? "").trim();
        if (tline === "") continue;
        if (HINT_RE.test(tline)) {
            hintLines.push(tline);
            end = k;
        } else {
            break;
        }
    }
    const hint = hintLines.length > 0 ? hintLines.join(" · ") : null;

    // question：首个选项上方所有相关的提示行（直到分隔线或上限 20 行）
    let start = best.firstOpt;
    const qLines: string[] = [];
    for (let k = best.firstOpt - 1; k >= 0 && best.firstOpt - k <= 20; k--) {
        const raw = lines[k] ?? "";
        if (RULE_RE.test(raw)) break;
        qLines.unshift(raw);
        start = k;
    }
    while (qLines.length > 0 && qLines[0]?.trim() === "") qLines.shift();
    while (qLines.length > 0 && qLines[qLines.length - 1]?.trim() === "") qLines.pop();
    const question = qLines.length > 0 ? qLines.join("\n") : null;

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
