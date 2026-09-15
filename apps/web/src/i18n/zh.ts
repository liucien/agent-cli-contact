/** 中文词典（键的唯一来源，en.ts 以此约束键集合） */
export const zh = {
    // ---------- app / titlebar ----------
    "app.loading": "连接 gateway…",
    "titlebar.commands": "⌘K 命令",

    // ---------- 错误（ws 层） ----------
    "err.notConnected": "gateway 未连接",
    "err.disconnected": "gateway 连接已断开",

    // ---------- 消息主体显示名 ----------
    "party.user": "用户",
    "party.scheduler": "定时任务",

    // ---------- 侧栏 ----------
    "side.workspaces": "工作区",
    "side.agents": "AGENTS",
    "side.schedules": "定时任务",
    "side.newWorkspace": "+ 新建",
    "side.renameWorkspace": "重命名项目",
    "side.closeWorkspace": "关闭项目",
    "side.runNow": "立即运行",
    "side.needsConfirm": "待确认",

    // ---------- 项目管理 ----------
    "ws.promptName": "项目名称：",
    "ws.promptCwd": "目录路径（可选，留空跳过）：",
    "ws.promptRename": "新的项目名称：",
    "ws.confirmClose": "关闭项目 {label}？其下 agent pane 将被关闭。",

    // ---------- 主区 ----------
    "main.emptyAgent": "该项目暂无 agent",
    "main.termEmpty": "（等待终端输出…）",
    "main.meshView": "Mesh 视图",
    "main.openEditor": "在编辑器打开",
    "main.inputPlaceholder": "向 {name} 发送指令…",
    "main.kbdHint": "⌘⇧M 切换模型 · ⌘⇧P 切换权限",
    "main.send": "发送",

    // ---------- 右栏 tabs ----------
    "tab.terminal": "终端",
    "tab.computer": "Computer",
    "tab.collab": "协作",
    "rp.placeholder": "此 MVP 暂未启用 · 见 M2/M3",

    // ---------- 协作 tab ----------
    "collab.relations": "协作关系",
    "collab.addRule": "+ 规则",
    "collab.deleteRule": "删除规则",
    "collab.trigger.done": "等待 done 后…",
    "collab.trigger.blocked": "等待 blocked 后…",
    "collab.trigger.idle": "等待 idle 后…",
    "collab.waitingIdle": "等待其空闲",
    "collab.noRelations": "暂无协作关系",
    "collab.messages": "消息流",
    "collab.blockedTitle": "{name} 进入 blocked",
    "collab.waitManual": "等待人工确认",
    "collab.noMessages": "暂无 agent 间消息",
    "collab.asAgent": "以 {name}",
    "collab.asUser": "以 用户",
    "collab.fromTitle": "发送身份",
    "collab.toTitle": "发送目标",
    "collab.msgPlaceholder": "发送 agent 间消息…",

    // ---------- 按钮 ----------
    "btn.approve": "批准",
    "btn.deny": "拒绝",
    "btn.openPane": "打开 pane",
    "btn.approveInject": "放行并注入",
    "btn.editApprove": "编辑后放行",
    "btn.reject": "驳回",
    "btn.confirmApprove": "确认放行",
    "btn.cancel": "取消",
    "btn.create": "创建",

    // ---------- 状态标签 ----------
    "status.injected": "已送达",
    "status.injectedShort": "已注入",
    "status.held": "待放行",
    "status.queued": "队列中",
    "status.denied": "已驳回",
    "status.pending": "待处理",
    "status.listening": "监听中",

    // ---------- 规则表单 ----------
    "rule.enters": "进入",
    "rule.then": "后 →",
    "rule.promptPlaceholder": "注入的指令 prompt…",
    "rule.oneShot": "仅触发一次",

    // ---------- Mesh 全屏视图 ----------
    "mesh.back": "‹ 返回",
    "filter.all": "全部",
    "filter.blockedOnly": "仅 blocked",
    "filter.lastHour": "最近 1 小时",
    "filter.fromSchedule": "定时任务产生",
    "mesh.relayApproval": "中继审批",
    "mesh.relayToggle": "切换 mesh 中继审批",
    "mesh.newRule": "＋ 新建协作规则",
    "mesh.noAgents": "暂无 agent",
    "mesh.edgePrompt": "prompt ×{n} · 最近 {time}",
    "mesh.edgeQueued": "prompt ×{n} · 队列中",
    "mesh.edgeHeld": "回传 ×{n} · 待放行",
    "mesh.chipQueue": "队列 {n}",
    "mesh.chipHeld": "{n} 条意见待放行",
    "mesh.chipWaiting": "⌛ 等待中",
    "mesh.detailHint": "点击节点或连线查看两个 agent 之间的会话",
    "mesh.detailSubOn": "{n} 条消息 · 中继审批已开启 · 通过 gateway MCP 转发",
    "mesh.detailSubOff": "{n} 条消息 · 中继审批已关闭 · 通过 gateway MCP 转发",
    "mesh.noMessagesBetween": "两者之间暂无消息",
    "mesh.timeline": "通信时间线",
    "mesh.noRecords": "暂无记录",
    "mesh.system": "系统",
    "kind.wait": "等待",
    "kind.prompt": "prompt",
    "kind.status": "状态",

    // ---------- 配置弹层 ----------
    "cfg.title": "Agent 配置",
    "cfg.savePreset": "存为预设",
    "cfg.model": "模型",
    "cfg.reasoning": "推理强度",
    "cfg.context": "上下文窗口",
    "cfg.permission": "权限模式",
    "cfg.current": "当前",
    "cfg.reasoningNote": "强度与上下文即时生效，作用于下一个 turn。",
    "cfg.permPlanNote": "只读 · 仅产出计划",
    "cfg.permAskNote": "写操作逐次确认",
    "cfg.permFullNote": "自动批准",
    "cfg.fullWarn": "⚠ Full access 下 mesh 消息与 computer use 仍需人工放行；",
    "cfg.fullWarn2": "定时任务运行中禁止切换到 Full access。",
    "cfg.presets": "预设",
    "cfg.newPreset": "＋ 新建",
    "cfg.howTitle": "生效方式：",
    "cfg.howBody":
        "模型 / 推理强度 → 注入 slash 命令即时生效；权限模式 → 重启 herdr 会话（自动 resume 上下文，约 3s，working 中将排队到 turn 结束）。",
    "cfg.apply": "应用",
    "cfg.presetNamePrompt": "预设名称：",
    "cfg.presetSaved": "预设「{name}」已保存",
    "cfg.appliedNow": "即时生效：{items}",
    "cfg.queuedTurn": "排队至 turn 结束：{items}",
    "cfg.restartRequired": "需重启会话：{items}",
    "cfg.noChange": "配置未变化",
    "cfg.listSep": "、",
    "cfg.partSep": "；",

    // ---------- 设置弹层 ----------
    "set.title": "设置",
    "set.editorCommand": "编辑器命令",
    "set.editorCaption":
        '目录路径将作为最后一个参数传入，如：code · cursor · subl · open -a "WebStorm"',
    "set.save": "保存",

    // ---------- 状态栏 ----------
    "sb.connected": "gateway 已连接",
    "sb.disconnected": "gateway 未连接",
    "sb.mock": "mock 模式",
    "sb.agents": "{n} agents · {m} blocked",
    "sb.relay": "mesh 中继审批：{state}",
    "sb.on": "开",
    "sb.off": "关",
};
