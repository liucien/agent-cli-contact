import type { zh } from "./zh";

/** English dictionary — key set is constrained by zh.ts */
export const en = {
    // ---------- app / titlebar ----------
    "app.loading": "Connecting to gateway…",
    "titlebar.commands": "⌘K Commands",

    // ---------- errors (ws layer) ----------
    "err.notConnected": "gateway not connected",
    "err.disconnected": "gateway connection lost",

    // ---------- party display names ----------
    "party.user": "User",
    "party.scheduler": "Scheduler",

    // ---------- sidebar ----------
    "side.workspaces": "PROJECTS",
    "side.schedules": "SCHEDULES",
    "side.newWorkspace": "+ New",
    "side.renameWorkspace": "Double-click to rename",
    "side.closeWorkspace": "Close project",
    "side.noWorkspaces": "Create a project to start",
    "side.closeAgent": "Close agent",
    "side.noAgents": "No agents",
    "side.runNow": "Run now",
    "side.needsConfirm": "Needs review",

    // ---------- workspace management ----------
    "ws.promptName": "Project name:",
    "ws.pickDir": "Choose project directory",
    "ws.promptCwd": "Directory path:",
    "ws.promptRename": "New project name:",
    "ws.confirmClose": "Close project {label}? Its agent panes will be closed.",

    // ---------- agent management ----------
    "agent.compose": "New agent chat",
    "agent.confirmClose": "Close agent {name}?",

    // ---------- main pane ----------
    "main.emptyShell": "Create a project and add an agent to get started",
    "main.heroTitle": "What should we build in {name}?",
    "main.heroSub": "Type an instruction below — it goes straight to {agent}",
    "main.termEmpty": "(waiting for terminal output…)",
    "main.meshView": "Mesh view",
    "main.openEditor": "Open in editor",
    "main.inputPlaceholder": "Send instructions to {name}…",
    "main.kbdHint": "⌘⇧M switch model · ⌘⇧P switch permissions",
    "main.send": "Send",

    // ---------- image attachments ----------
    "img.attach": "Attach images",
    "img.tooMany": "At most {max} images per message",
    "img.tooLarge": "Image {name} exceeds 10MB",
    "img.defaultPrompt": "Please look at the attached image(s)",

    // ---------- right panel tabs ----------
    "tab.terminal": "Terminal",
    "tab.computer": "Computer",
    "tab.collab": "Collab",
    "rp.placeholder": "Not enabled in this MVP · see M2/M3",

    // ---------- collab tab ----------
    "collab.relations": "Collaboration",
    "collab.addRule": "+ Rule",
    "collab.deleteRule": "Delete rule",
    "collab.trigger.done": "When done…",
    "collab.trigger.blocked": "When blocked…",
    "collab.trigger.idle": "When idle…",
    "collab.waitingIdle": "Waiting until idle",
    "collab.noRelations": "No collaboration rules yet",
    "collab.messages": "Message feed",
    "collab.blockedTitle": "{name} is blocked",
    "collab.waitManual": "Waiting for manual confirmation",
    "collab.noMessages": "No inter-agent messages yet",
    "collab.asAgent": "As {name}",
    "collab.asUser": "As user",
    "collab.fromTitle": "Send as",
    "collab.toTitle": "Send to",
    "collab.msgPlaceholder": "Send an inter-agent message…",

    // ---------- buttons ----------
    "btn.approve": "Approve",
    "btn.deny": "Deny",
    "btn.openPane": "Open pane",
    "btn.approveInject": "Approve & inject",
    "btn.editApprove": "Edit & approve",
    "btn.reject": "Reject",
    "btn.confirmApprove": "Confirm & approve",
    "btn.cancel": "Cancel",
    "dlg.ok": "OK",
    "btn.create": "Create",

    // ---------- status tags ----------
    "status.injected": "Delivered",
    "status.injectedShort": "Injected",
    "status.held": "Pending approval",
    "status.queued": "Queued",
    "status.denied": "Rejected",
    "status.pending": "Needs attention",
    "status.listening": "Listening",

    // ---------- rule form ----------
    "rule.enters": "enters",
    "rule.then": "→ then",
    "rule.promptPlaceholder": "Prompt to inject…",
    "rule.oneShot": "Trigger once only",

    // ---------- mesh full view ----------
    "mesh.back": "‹ Back",
    "filter.all": "All",
    "filter.blockedOnly": "Blocked only",
    "filter.lastHour": "Last hour",
    "filter.fromSchedule": "From schedules",
    "mesh.relayApproval": "Relay approval",
    "mesh.relayToggle": "Toggle mesh relay approval",
    "mesh.newRule": "＋ New collaboration rule",
    "mesh.noAgents": "No agents",
    "mesh.edgePrompt": "prompt ×{n} · last {time}",
    "mesh.edgeQueued": "prompt ×{n} · queued",
    "mesh.edgeHeld": "replies ×{n} · pending approval",
    "mesh.chipQueue": "Queue {n}",
    "mesh.chipHeld": "{n} replies pending approval",
    "mesh.chipWaiting": "⌛ Waiting",
    "mesh.detailHint": "Click a node or an edge to view the conversation between two agents",
    "mesh.detailSubOn": "{n} messages · relay approval on · relayed via gateway MCP",
    "mesh.detailSubOff": "{n} messages · relay approval off · relayed via gateway MCP",
    "mesh.noMessagesBetween": "No messages between them yet",
    "mesh.timeline": "Communication timeline",
    "mesh.noRecords": "No records yet",
    "mesh.system": "system",
    "kind.wait": "Wait",
    "kind.prompt": "prompt",
    "kind.status": "Status",

    // ---------- config popover ----------
    "cfg.title": "Agent config",
    "cfg.savePreset": "Save as preset",
    "cfg.model": "Model",
    "cfg.reasoning": "Reasoning effort",
    "cfg.context": "Context window",
    "cfg.permission": "Permission mode",
    "cfg.current": "Current",
    "cfg.detectedNote": "Detected from session",
    "cfg.reasoningNote": "Effort and context apply immediately, starting from the next turn.",
    "cfg.permPlanNote": "Read-only · plan output only",
    "cfg.permAskNote": "Confirm each write",
    "cfg.permFullNote": "Auto-approve",
    "cfg.fullWarn":
        "⚠ Under Full access, mesh messages and computer use still need manual approval; ",
    "cfg.fullWarn2": "switching to Full access is blocked while a schedule is running.",
    "cfg.presets": "Presets",
    "cfg.newPreset": "＋ New",
    "cfg.howTitle": "How changes apply: ",
    "cfg.howBody":
        "Model / reasoning effort → injected as a slash command, effective immediately; permission mode → restarts the herdr session (context auto-resumes, ~3s; queued until end of turn while working).",
    "cfg.apply": "Apply",
    "cfg.presetNamePrompt": "Preset name:",
    "cfg.presetSaved": 'Preset "{name}" saved',
    "cfg.appliedNow": "Applied now: {items}",
    "cfg.queuedTurn": "Queued until end of turn: {items}",
    "cfg.restartRequired": "Restart required: {items}",
    "cfg.noChange": "No config changes",
    "cfg.listSep": ", ",
    "cfg.partSep": "; ",

    // ---------- settings popover ----------
    "set.title": "Settings",
    "set.editorCommand": "Editor command",
    "set.editorCaption":
        'The directory path is appended as the last argument, e.g. code · cursor · subl · open -a "WebStorm"',
    "set.save": "Save",

    // ---------- setup guide ----------
    "setup.title": "herdr setup",
    "setup.subtitle":
        "agent-cli-contact is a GUI layer for herdr and needs a herdr server running on this machine.",
    "setup.step1": "Install herdr",
    "setup.step2": "Start herdr server",
    "setup.copy": "Copy",
    "setup.copied": "Copied",
    "setup.autoInstall": "Install automatically",
    "setup.installing": "Installing…",
    "setup.noBrewA": "Homebrew not detected: install it from",
    "setup.noBrewB": "first, or see",
    "setup.noBrewC": "for manual installation",
    "setup.startBtn": "Start herdr server",
    "setup.starting": "Starting…",
    "setup.startCaption":
        "herdr server runs persistently in the background; stop it with: herdr server stop",
    "setup.recheck": "Recheck",
    "setup.autoNote": "This screen advances automatically once herdr is ready",

    // ---------- status bar ----------
    "sb.connected": "gateway connected",
    "sb.disconnected": "gateway disconnected",
    "sb.agents": "{n} agents · {m} blocked",
    "sb.relay": "mesh relay approval: {state}",
    "sb.on": "on",
    "sb.off": "off",
} satisfies Record<keyof typeof zh, string>;
