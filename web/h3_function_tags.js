import { app } from "../../scripts/app.js";

const TAG_PROPERTY = "xiantuFunctionTag";
const TAG_LABELS = Object.freeze({
    speed: "加速", optimization: "性能优化", sampling: "采样 SIGMAS", model: "模型", lora: "LoRA", custom: "自定义",
});

export function readFunctionTag(node) {
    const tag = node.properties?.[TAG_PROPERTY];
    return tag && typeof tag === "object"
        ? { category: String(tag.category || "custom"), label: String(tag.label || ""), note: String(tag.note || "") }
        : null;
}

function tagName(tag) {
    if (tag.category === "custom") return tag.label || tag.note || TAG_LABELS.custom;
    return Object.hasOwn(TAG_LABELS, tag.category) ? TAG_LABELS[tag.category] : (tag.label || tag.note || "已标记");
}

function writeTag(node, tag) {
    node.properties ??= {};
    if (tag) node.properties[TAG_PROPERTY] = tag;
    else delete node.properties[TAG_PROPERTY];
    node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
}

export function updateFunctionTagNote(node, note) {
    const tag = readFunctionTag(node);
    if (tag) writeTag(node, { ...tag, note: note.trim().slice(0, 160) });
}

function chooseTag(node, category) {
    const current = readFunctionTag(node);
    if (category !== "custom") {
        if (current?.category !== category) writeTag(node, { category, label: "", note: TAG_LABELS[category] });
        return;
    }
    const previousName = current?.category === "custom" && tagName(current) !== TAG_LABELS.custom ? tagName(current) : "";
    const label = window.prompt("请输入自定义功能标记名称", previousName)?.trim().slice(0, 30);
    if (label === undefined) return;
    if (!label) { window.alert("自定义功能标记名称不能为空"); return; }
    writeTag(node, { category, label, note: current?.category === "custom" && current.label ? current.note : "" });
}

function canTag(node) {
    const nodeType = node.comfyClass || node.type;
    return nodeType !== "ComfyUIH3ImageWorkbench" && nodeType !== "XiantuVideoEditorWorkbench";
}

app.registerExtension({
    name: "Xiantu.H3ImageFunctionTags",
    beforeRegisterNodeDef(nodeType) {
        const prototype = nodeType.prototype;
        // Use the existing flag so both installed extensions share one canvas menu and badge.
        if (prototype.__xiantuFunctionTagMenuInstalled) return;
        prototype.__xiantuFunctionTagMenuInstalled = true;
        const previousMenu = prototype.getExtraMenuOptions;
        prototype.getExtraMenuOptions = function (canvas, options) {
            const result = previousMenu?.apply(this, arguments);
            if (!Array.isArray(options) || !canTag(this)) return result;
            const tag = readFunctionTag(this);
            const choices = Object.entries(TAG_LABELS).map(([category, label]) => ({
                content: `${tag?.category === category ? "✓ " : ""}${label}`,
                callback: () => chooseTag(this, category),
            }));
            if (tag) choices.push(null, { content: "取消功能标记", callback: () => writeTag(this, null) });
            options.unshift({
                content: tag ? `闲兔功能标记：${tagName(tag)}` : "闲兔功能标记",
                has_submenu: true,
                submenu: { options: choices },
            });
            return result;
        };
        const previousDraw = prototype.onDrawForeground;
        prototype.onDrawForeground = function (context) {
            previousDraw?.apply(this, arguments);
            const tag = readFunctionTag(this);
            if (!tag || this.flags?.collapsed || !canTag(this)) return;
            const label = tagName(tag);
            const nodeWidth = Number(this.size?.[0] || 180);
            context.save();
            context.font = "bold 12px sans-serif";
            const width = Math.min(Math.max(70, context.measureText(label).width + 18), Math.max(70, nodeWidth - 70));
            const x = Math.max(4, nodeWidth - width - 8);
            context.fillStyle = "#07343b";
            context.strokeStyle = "#18dfe2";
            context.lineWidth = 1;
            context.fillRect(x, -25, width, 19);
            context.strokeRect(x, -25, width, 19);
            context.fillStyle = "#8bfff8";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(label, x + width / 2, -15.5, width - 10);
            context.restore();
        };
    },
});
