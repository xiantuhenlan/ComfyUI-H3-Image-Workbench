export function textSettings(image) {
    image.generateText = { enabled: false, max_length: 1536, thinking: true, use_default_template: true,
        mtp: "auto", system_prompt: "", sampling_mode: {sampling_mode: "off"},
        ...(image.generateText || {}) };
    delete image.generateText.automaticSize;
    return image.generateText;
}

export function h3JobInputs(inputs, image, state) {
    textSettings(image);
    inputs.workbench_state = JSON.stringify(state);
    // Remove previous revision's external controls from the submitted node.
    for (const key of ["prompt","width","height","images","textgen_images","textgen_videos","textgen_audios"])
        delete inputs[key];
}

export function mountH3PromptControls(root, node, state, getImage, save, selectTab) {
    const panel = document.createElement("section");
    panel.className = "h3iaw-optimized-prompt";
    panel.dataset.promptPane = "optimized";
    panel.hidden = true;
    panel.innerHTML = '<textarea readonly data-h3-optimized placeholder="优化结果显示在这里"></textarea>';
    for (const field of [root.querySelector('[data-prompt]'), panel.querySelector('[data-h3-optimized]')]) {
        field.addEventListener('dblclick', event => {
            event.preventDefault();
            field.focus();
            field.select();
        });
    }
    const tab = document.createElement("button");
    tab.textContent = "优化提示词";
    tab.dataset.promptTab = "optimized";
    tab.onclick = () => selectTab("optimized");
    root.querySelector('[data-prompt-tab="positive"]').after(tab);
    const toggle = document.createElement("label");
    toggle.className = "h3iaw-optimize-switch";
    toggle.innerHTML = '<input type="checkbox" aria-label="启用提示词优化">启用';
    tab.after(toggle);
    const checkbox = toggle.querySelector("input");
    checkbox.onchange = () => {
        textSettings(getImage()).enabled = checkbox.checked;
        save();
        if (!checkbox.checked) selectTab("positive");
    };
    root.querySelector(".h3iaw-prompt-fields").appendChild(panel);
    let activeId = "";
    function refresh() {
        const image = getImage();
        const identity = `${state.activeShotId}:${image.id}`;
        if (activeId !== identity) { activeId = identity; selectTab("positive"); }
        checkbox.checked = Boolean(textSettings(image).enabled);
        panel.querySelector("[data-h3-optimized]").value = image.h3GeneratedText || "";
    }
    node.__h3PromptReceive = message => {
        if (!root.isConnected) return;
        const shot = state.shots.find(item => item.id === message.h3_shot_id?.[0]);
        const image = shot?.images?.find(item => item.id === message.h3_task_id?.[0]);
        if (!image) return;
        const generated = message.h3_generated_text?.[0];
        if (generated != null) image.h3GeneratedText = generated;
        save(); refresh();
        if (getImage() === image && generated != null && textSettings(image).enabled) selectTab("optimized");
    };
    if (!node.__h3PromptHandlerInstalled) {
        const prior = node.onExecuted;
        node.onExecuted = function(message) {
            const result = prior?.call(this, message);
            this.__h3PromptReceive?.(message);
            return result;
        };
        node.__h3PromptHandlerInstalled = true;
    }
    root.querySelector("[data-model-profile]").replaceChildren(new Option("H3 模型", "MOSS"));
    refresh();
    selectTab("positive");
    return refresh;
}
