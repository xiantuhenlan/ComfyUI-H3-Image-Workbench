import { readFunctionTag, updateFunctionTagNote } from "./h3_function_tags.js";

const LORA_MODES = Object.freeze({ 0: "启用", 4: "忽略", 2: "关闭" });

export function normalizeLoraModes(value) {
    return Object.fromEntries(Object.entries(value || {}).filter(([, mode]) => [0, 4, 2].includes(mode)));
}

function visitNodes(starts, edges) {
    const visited = new Set();
    const pending = [...starts];
    while (pending.length) {
        const id = pending.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        pending.push(...(edges.get(id) || []));
    }
    return visited;
}

function connectedLoraNodes(controller) {
    const graph = controller.graph;
    const nodes = graph?._nodes || [];
    const parents = new Map();
    const children = new Map();
    const getLink = id => graph.getLink?.(id) ?? (graph.links instanceof Map ? graph.links.get(id) : graph.links?.[id]);
    const addParent = (id, origin) => {
        if (origin == null) return;
        const source = String(origin);
        parents.get(id).push(source);
        if (!children.has(source)) children.set(source, []);
        children.get(source).push(id);
    };
    const setters = new Map();
    for (const node of nodes) {
        const name = node.widgets?.[0]?.value;
        if (node.type === "SetNode" && name) setters.set(name, setters.has(name) ? null : node);
    }
    for (const node of nodes) {
        const id = String(node.id);
        parents.set(id, []);
        for (const input of node.inputs || []) {
            if (input.link == null) continue;
            const link = getLink(input.link);
            addParent(id, Array.isArray(link) ? link[1] : link?.origin_id);
        }
        const setter = node.type === "GetNode" && setters.get(node.widgets?.[0]?.value);
        if (setter?.inputs?.[0]?.link != null && getLink(setter.inputs[0].link)) addParent(id, setter.id);
    }
    const descendants = visitNodes([String(controller.id)], children);
    const scope = visitNodes(descendants, parents);
    return nodes.filter(node => scope.has(String(node.id)) && readFunctionTag(node)?.category === "lora");
}

function selectedMode(node, state, task) {
    return state.loraGlobalModes[node.id] ?? task.loraModes?.[node.id] ?? node.mode ?? 0;
}

export async function serializeWithLoraModes(controller, state, task, serialize) {
    if (!Object.keys(state.loraGlobalModes).length && !Object.keys(task.loraModes || {}).length) return serialize();
    const previousModes = [];
    for (const node of connectedLoraNodes(controller)) {
        const mode = selectedMode(node, state, task);
        if (mode === (node.mode ?? 0)) continue;
        previousModes.push([node, node.mode]);
        node.mode = mode;
    }
    try {
        return await serialize();
    } finally {
        for (const [node, mode] of previousModes) node.mode = mode;
    }
}

export function mountLoraControls(root, controller, state, { getShot, getTask, usesCanvas, save }) {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "LoRA";
    trigger.dataset.h3LoraOpen = "";
    root.querySelector("[data-camera-control]").before(trigger);
    const dialog = document.createElement("dialog");
    dialog.className = "h3iaw-dialog h3iaw-lora-dialog";
    dialog.setAttribute("aria-label", "LoRA 功能");
    dialog.innerHTML = `
        <header><b>LoRA 功能</b><button type="button" data-lora-close aria-label="关闭">×</button></header>
        <div class="h3iaw-lora-heading"><b>LoRA 标记节点</b><span data-lora-shot></span><button type="button" data-lora-default>使用默认</button></div>
        <div class="h3iaw-lora-list" data-lora-list></div>
        <footer><button type="button" data-lora-close>关闭</button></footer>`;
    root.append(dialog);
    const list = dialog.querySelector("[data-lora-list]");
    const reset = dialog.querySelector("[data-lora-default]");

    const render = () => {
        const shot = getShot();
        const task = getTask(shot);
        const canvas = usesCanvas(task);
        const nodes = canvas ? connectedLoraNodes(controller) : [];
        reset.disabled = !nodes.some(node => task.loraModes?.[node.id] != null);
        list.replaceChildren();
        dialog.querySelector("[data-lora-shot]").textContent = shot.title;
        if (!nodes.length) {
            const empty = document.createElement("p");
            empty.textContent = canvas ? "请在当前生成链的节点上右键选择「闲兔功能标记 → LoRA」。" : "当前模式使用内置生成链。接入画布生成链后，可以选择标记过的 LoRA 节点。";
            list.append(empty);
        }
        for (const node of nodes) {
            const row = document.createElement("article");
            row.className = "h3iaw-lora-row";
            row.innerHTML = `
                <div class="h3iaw-lora-identity"><b></b><small></small></div>
                <div class="h3iaw-lora-note"><span></span><input type="text" maxlength="160" placeholder="备注这个节点的功能" aria-label="LoRA 备注" hidden></div>
                <label class="h3iaw-lora-global"><input type="checkbox" data-lora-global> 全局</label>
                <button type="button" data-lora-note-edit>编辑</button>
                <div class="h3iaw-lora-modes">${[0, 4, 2].map(mode => `<button type="button" data-lora-mode="${mode}">${LORA_MODES[mode]}</button>`).join("")}</div>`;
            row.querySelector(".h3iaw-lora-identity b").textContent = node.title || node.type || "LoRA";
            row.querySelector(".h3iaw-lora-identity small").textContent = `LoRA · 节点 ${node.id}`;
            const note = row.querySelector(".h3iaw-lora-note span");
            const noteInput = row.querySelector(".h3iaw-lora-note input");
            note.textContent = readFunctionTag(node).note || "暂无备注";
            const edit = row.querySelector("[data-lora-note-edit]");
            const finishNote = (commit) => {
                if (commit) updateFunctionTagNote(node, noteInput.value);
                note.textContent = readFunctionTag(node)?.note || "暂无备注";
                noteInput.hidden = true;
                note.hidden = false;
                edit.textContent = "编辑";
            };
            edit.onclick = () => {
                if (!noteInput.hidden) { finishNote(true); return; }
                noteInput.value = readFunctionTag(node)?.note || "";
                noteInput.hidden = false;
                note.hidden = true;
                edit.textContent = "保存";
                noteInput.focus();
                noteInput.select();
            };
            noteInput.onkeydown = event => {
                if (event.key !== "Enter" && event.key !== "Escape") return;
                event.preventDefault();
                finishNote(event.key === "Enter");
                edit.focus();
            };
            const global = row.querySelector("[data-lora-global]");
            global.checked = Object.hasOwn(state.loraGlobalModes, node.id);
            global.onchange = () => {
                const mode = selectedMode(node, state, task);
                if (global.checked) {
                    state.loraGlobalModes[node.id] = mode;
                    for (const shot of state.shots) delete getTask(shot).loraModes?.[node.id];
                } else {
                    delete state.loraGlobalModes[node.id];
                    (task.loraModes ??= {})[node.id] = mode;
                }
                save(); render();
            };
            for (const button of row.querySelectorAll("[data-lora-mode]")) {
                const mode = Number(button.dataset.loraMode);
                const active = mode === selectedMode(node, state, task);
                button.classList.toggle("active", active);
                button.setAttribute("aria-pressed", String(active));
                button.onclick = () => {
                    const modes = global.checked ? state.loraGlobalModes : (task.loraModes ??= {});
                    modes[node.id] = mode;
                    save(); render();
                };
            }
            list.append(row);
        }
    };
    reset.onclick = () => { delete getTask().loraModes; save(); render(); };
    trigger.onclick = () => { render(); dialog.showModal(); };
    dialog.onclick = event => { if (event.target === dialog) dialog.close(); };
    for (const button of dialog.querySelectorAll("[data-lora-close]")) button.onclick = () => dialog.close();
}
