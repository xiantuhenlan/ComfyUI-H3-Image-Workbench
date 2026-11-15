export const H3_IMAGE_SAVE = "h3-image-save";
export const H3_IMAGE_PROMPT = "h3-image-prompt";
export const H3_IMAGE_MAX_REFERENCES = 16;
export const H3_IMAGE_RESOLUTIONS = [4, 8, 12, 16, 20];
const OUTPUT_FOLDER = "H3生图";

export function h3ImageFilenamePrefix(state) {
    const name = String(state?.saveFilename || "").trim().replace(/\.png$/i, "")
        .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "-").slice(0, 100).replace(/[ .]+$/, "");
    return `${OUTPUT_FOLDER}/${name || OUTPUT_FOLDER}`;
}

export function setCanvasImageFilename(output, controllerId, state) {
    const children = new Map();
    for (const [id, node] of Object.entries(output)) {
        for (const input of Object.values(node.inputs || {})) {
            if (!Array.isArray(input) || input.length !== 2 || typeof input[0] !== "string" || !output[input[0]]) continue;
            if (!children.has(input[0])) children.set(input[0], []);
            children.get(input[0]).push(id);
        }
    }
    const prefix = h3ImageFilenamePrefix(state);
    const pending = [String(controllerId)];
    const visited = new Set();
    while (pending.length) {
        const id = pending.pop();
        if (visited.has(id)) continue;
        visited.add(id);
        const node = output[id];
        if (node?.class_type === "SaveImage" && node.inputs && !Array.isArray(node.inputs.filename_prefix)) {
            node.inputs.filename_prefix = prefix;
        }
        pending.push(...(children.get(id) || []));
    }
}

export const H3_IMAGE_EDIT_NODES = Object.freeze({
    save: "9", conditioning: "32", optimizer: "34", preview: "37", sampler: "38",
    switch: "41", prompt: "43", reference: "45", aligned: "48", size: "50",
    resize: "56", enableOptimizer: "61",
});

export function configureOfficialH3ImageEdit(output, task, state) {
    const ids = H3_IMAGE_EDIT_NODES;
    const types = {
        save: "SaveImage", conditioning: "MiniMaxH3ImageConditioning", optimizer: "TextGenerateV2",
        preview: "PreviewAny", sampler: "KSampler", switch: "ComfySwitchNode",
        prompt: "PrimitiveStringMultiline", reference: "LoadImage", aligned: "ResizeImageMaskNode",
        size: "GetImageSize", resize: "ResizeImageMaskNode", enableOptimizer: "PrimitiveBoolean",
    };
    const inputs = {};
    for (const [key, type] of Object.entries(types)) {
        const entry = output?.[ids[key]];
        if (entry?.class_type !== type || !entry.inputs) throw new Error("官方 H3-IMAGE 编辑节点缺失：" + type);
        inputs[key] = entry.inputs;
    }
    const refs = task.referenceImages || [];
    if (!refs.length) throw new Error("请先上传一张主参考图。");
    if (refs.length > H3_IMAGE_MAX_REFERENCES) throw new Error("H3-IMAGE 最多支持 16 张参考图。");
    inputs.reference.image = h3ImageReferencePath(refs[0]);
    inputs.prompt.value = task.prompt.trim();
    inputs.enableOptimizer.value = Boolean(task.generateText?.enabled);
    if (!Array.isArray(inputs.save.filename_prefix)) inputs.save.filename_prefix = h3ImageFilenamePrefix(state);
    if (state?.h3ImageMatchReference === false) {
        const { width, height } = h3ImageSize(state.megapixels, state.aspect);
        inputs.conditioning.width = width;
        inputs.conditioning.height = height;
    }
    for (const [index, record] of refs.slice(1).entries()) {
        const number = index + 2;
        const referenceId = "h3-edit-reference-" + number;
        output[referenceId] = { class_type: "LoadImage", inputs: { image: h3ImageReferencePath(record) } };
        inputs.conditioning["images.image_" + number] = [referenceId, 0];
        inputs.optimizer["images.image" + number] = [referenceId, 0];
    }
}

export function h3ImageReferencePath(record) {
    const name = record?.name || record?.filename;
    const type = record?.type || "input";
    if (!name || !["input", "output", "temp"].includes(type)) throw new Error("参考图路径无效。");
    return [record.subfolder, name].filter(Boolean).join("/") + (type === "input" ? "" : " [" + type + "]");
}

export const H3_IMAGE_MODELS = {
    unet: ["UNETLoader", "unet_name", "minimax_h3_image_pruned_int8_convrot.safetensors", /^minimax[-_]h3[-_]image(?:[-_]|\.|$)/i],
    clip: ["CLIPLoader", "clip_name", "qwen3vl_32b_minimax_h3_int8_convrot.safetensors", /^qwen3vl[_-]32b[_-]minimax[_-]h3(?:[_-]|\.|$)/i],
    vae: ["VAELoader", "vae_name", "minimax_h3_image_vae_fp16.safetensors", /^minimax[-_]h3[-_]image[-_]vae(?:[-_]|\.|$)/i],
    upsampler: ["CLIPLoader", "clip_name", "qwen3.5_9b_w4a8_gptq.safetensors", /^qwen3[._-](?:5|8)(?:[-_]|$)/i],
};

export function modelOptions(key, info) {
    const [, input, , accepts] = H3_IMAGE_MODELS[key];
    const spec = info?.input?.required?.[input];
    const choices = Array.isArray(spec?.[0]) ? spec[0] : spec?.[1]?.options || [];
    return choices.filter(name => typeof name === "string" && accepts.test(name.split(/[\\/]/).at(-1)));
}

export function h3ImageSize(megapixels, aspect) {
    const [x, y] = aspect.split(":").map(Number);
    const ratio = x && y ? x / y : 1;
    const pixels = megapixels * 1024 ** 2;
    return {
        width: Math.round(Math.sqrt(pixels * ratio) / 32) * 32,
        height: Math.round(Math.sqrt(pixels / ratio) / 32) * 32,
    };
}

export function isH3ImageHistory(history) {
    const prompt = Array.isArray(history?.prompt) ? history.prompt[2] : history?.prompt?.output || history?.prompt;
    return prompt?.[H3_IMAGE_SAVE]?.class_type === "SaveImage" &&
        prompt?.["h3-image-conditioning"]?.class_type === "MiniMaxH3ImageConditioning";
}

export function buildH3ImagePrompt(state, task, seed, prompts) {
    const output = {};
    const add = (id, class_type, inputs) => {
        output[id] = { class_type, inputs };
        return [id, 0];
    };
    const modelFile = key => {
        const [, , fallback, accepts] = H3_IMAGE_MODELS[key];
        const value = state.h3ImageModels?.[key] || fallback;
        if (typeof value !== "string" || !accepts.test(value.split(/[\\/]/).at(-1))) {
            throw new Error("请选择 H3-IMAGE 对应的模型文件。");
        }
        return value;
    };
    const isEdit = task.generationMode === "图生图";
    const refs = isEdit ? task.referenceImages || [] : [];
    if (isEdit && !refs.length) throw new Error("图生图请先添加一张主参考图。");
    if (refs.length > H3_IMAGE_MAX_REFERENCES) throw new Error("H3-IMAGE 最多支持 16 张参考图。");
    const model = add("h3-image-model", "UNETLoader", { unet_name: modelFile("unet"), weight_dtype: "default" });
    const clip = add("h3-image-clip", "CLIPLoader", { clip_name: modelFile("clip"), type: "minimax", device: "default" });
    const vae = add("h3-image-vae", "VAELoader", { vae_name: modelFile("vae") });
    const images = refs.map((record, index) =>
        add("h3-image-ref-" + (index + 1), "LoadImage", { image: h3ImageReferencePath(record) }));
    if (images.length) {
        const resized = add("h3-image-ref-area", "ResizeImageMaskNode", {
            input: images[0], resize_type: "scale total pixels", "resize_type.megapixels": 4, scale_method: "area",
        });
        images[0] = add("h3-image-ref-aligned", "ResizeImageMaskNode", {
            input: resized, resize_type: "scale to multiple", "resize_type.multiple": 32, scale_method: "area",
        });
    }
    let { width, height } = h3ImageSize(state.megapixels, state.aspect);
    if (images.length && state.h3ImageMatchReference !== false) {
        width = add("h3-image-ref-size", "GetImageSize", { image: images[0] });
        height = [width[0], 1];
    }
    let prompt = task.prompt.trim();
    if (!prompt) throw new Error("请填写 H3-IMAGE 提示词。");
    if (task.generateText?.enabled) {
        const upsampler = add("h3-image-upsampler", "CLIPLoader", {
            clip_name: modelFile("upsampler"), type: "minimax", device: "default",
        });
        const template = isEdit ? prompts.edit : prompts.text;
        const inputs = {
            clip: upsampler, prompt: template.user.replace("{input text}", () => prompt),
            system_prompt: template.system, max_length: isEdit ? 8196 : 8192,
            sampling_mode: "on", "sampling_mode.temperature": 1, "sampling_mode.top_k": 20,
            "sampling_mode.top_p": 0.95, "sampling_mode.min_p": 0, "sampling_mode.repetition_penalty": 1,
            "sampling_mode.presence_penalty": 0, "sampling_mode.seed": seed, thinking: true,
            use_default_template: true, mtp: "auto",
        };
        images.forEach((image, index) => { inputs["images.image" + (index + 1)] = image; });
        const generated = add("h3-image-expand", "TextGenerateV2", inputs);
        prompt = add("h3-image-caption", "JsonExtractString", { json_string: generated, key: "expanded_caption" });
        add(H3_IMAGE_PROMPT, "PreviewAny", { source: prompt });
    }
    const conditionInputs = { clip, vae, prompt, width, height };
    images.forEach((image, index) => { conditionInputs["images.image_" + (index + 1)] = image; });
    const positive = add("h3-image-conditioning", "MiniMaxH3ImageConditioning", conditionInputs);
    const negative = add("h3-image-negative", "ConditioningZeroOut", { conditioning: positive });
    const latent = add("h3-image-sampling", "KSampler", {
        model, positive, negative, latent_image: [positive[0], 1], seed, steps: 6,
        cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1,
    });
    const decoded = add("h3-image-decode", "VAEDecode", { samples: latent, vae });
    add(H3_IMAGE_SAVE, "SaveImage", { images: decoded, filename_prefix: h3ImageFilenamePrefix(state) });
    return { output };
}

