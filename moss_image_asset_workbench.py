"""Workbench adapter for ComfyUI core PH3ImageConditioning / TextGenerateV2."""
from __future__ import annotations
import copy
import json
import logging
import re
from contextlib import ExitStack, contextmanager
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import MiniMaxH3ImageConditioning, PH3ImageConditioning
from comfy_extras.nodes_post_processing import scale_to_multiple_cover, scale_total_pixels
from comfy_extras.nodes_string import JsonExtractString
from comfy_extras.nodes_textgen import TextGenerateV2
from functools import lru_cache
from math import sqrt
from pathlib import Path, PurePosixPath
import nodes

_MISSING = object()
_OUTPUT_FOLDER = "H3生图"


def _filename_prefix(state):
    name = state.get("saveFilename")
    name = name.strip() if isinstance(name, str) else ""
    name = re.sub(r"\.png$", "", name, flags=re.IGNORECASE)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f\x7f]', "-", name)[:100].rstrip(" .")
    return f"{_OUTPUT_FOLDER}/{name or _OUTPUT_FOLDER}"


def _report_execution(phase, detail=""):
    try:
        from comfy_execution.utils import get_executing_context
        from server import PromptServer

        context = get_executing_context()
        server = PromptServer.instance
        if context is not None and server.client_id is not None:
            server.send_sync("xiantu_h3_image_progress", {
                "prompt_id": context.prompt_id, "node": context.node_id,
                "phase": phase, "detail": detail,
            }, server.client_id)
    except Exception:
        logging.debug("H3 image workbench progress delivery failed", exc_info=True)


def _active_task(raw):
    state = json.loads(raw or "{}")
    if not isinstance(state, dict):
        raise ValueError("工作台状态必须是 JSON 对象")
    shot = next((s for s in state.get("shots", []) if s.get("id") == state.get("activeShotId")), {})
    task = next((t for t in shot.get("images", []) if t.get("id") == shot.get("activeImageId")), {})
    return state, shot, task


@lru_cache(maxsize=1)
def _h3_image_prompts():
    path = Path(__file__).with_name("web") / "h3_image_official_prompts.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _match_projection_dtype(_module, inputs, output):
    return output.to(inputs[0].dtype)


@contextmanager
def _match_combined_projection_dtype(projection):
    forward = projection.forward
    instance_forward = vars(projection).get("forward")

    def project(x):
        output = forward(x)
        return output if output is NotImplemented else output.to(x.dtype)

    projection.forward = project
    try:
        yield
    finally:
        if instance_forward is None:
            del projection.forward
        else:
            projection.forward = instance_forward


@contextmanager
def _h3_prompt_precision(clip):
    # W4A8 projections can return a different dtype from the activation
    # used to allocate Qwen's attention caches. Match the activation dtype
    # for both the fused and individual projection paths.
    with ExitStack() as restore:
        for layer in clip.cond_stage_model.modules():
            for name in ("combined_qkv", "combined_qkvz"):
                projection = getattr(layer, name, None)
                linears = getattr(projection, "linears", ())
                if not any(getattr(linear, "quant_format", None) == "asym_w4a8_int8" for linear in linears):
                    continue
                restore.enter_context(_match_combined_projection_dtype(projection))
                for linear in linears:
                    restore.callback(linear.register_forward_hook(_match_projection_dtype).remove)
        yield


def _h3_image_conditioning(clip, vae, upsampler, state, task, prompt, images):
    if images:
        _report_execution("调整参考图尺寸")
        reference = scale_total_pixels(images["image_1"], 4, "area")
        images["image_1"] = scale_to_multiple_cover(reference, 32, "area")
    if images and state.get("h3ImageMatchReference") is not False:
        height, width = images["image_1"].shape[1:3]
    else:
        x, y = map(float, state.get("aspect", "1:1").split(":"))
        pixels = float(state.get("megapixels", 16)) * 1024 ** 2
        width = round(sqrt(pixels * x / y) / 32) * 32
        height = round(sqrt(pixels * y / x) / 32) * 32

    generated, reasoning = None, ""
    if (task.get("generateText") or {}).get("enabled", False):
        if upsampler is None:
            name = (state.get("h3ImageModels") or {}).get("upsampler", "qwen3.5_9b_w4a8_gptq.safetensors")
            if not name:
                raise ValueError("请在工作台选择 H3-IMAGE 提示词优化模型")
            _report_execution("加载提示词优化模型", name)
            upsampler, = nodes.CLIPLoader().load_clip(name, type="minimax")
        template = _h3_image_prompts()["edit" if images else "text"]
        _report_execution("优化提示词中")
        with _h3_prompt_precision(upsampler):
            text = TextGenerateV2.execute(
                clip=upsampler, prompt=template["user"].replace("{input text}", prompt),
                system_prompt=template["system"], max_length=8196 if images else 8192,
                sampling_mode={"sampling_mode": "on", "temperature": 1.0, "top_k": 20,
                               "top_p": 0.95, "min_p": 0.0, "repetition_penalty": 1.0,
                               "presence_penalty": 0.0, "seed": 0},
                thinking=True, use_default_template=True, mtp="auto",
                images={f"image{index}": image for index, image in enumerate(images.values(), 1)},
            )
        generated = JsonExtractString.execute(text.args[0], "expanded_caption").args[0]
        reasoning = text.args[1]
        if not generated:
            raise ValueError("H3-IMAGE 提示词优化未返回 expanded_caption，可关闭优化后重试")
        prompt = generated
    _report_execution("编码生成条件中")
    result = MiniMaxH3ImageConditioning.execute(
        clip=clip, prompt=prompt, width=width, height=height, vae=vae, images=images,
    )
    return result, prompt, generated, reasoning


class ComfyUIH3ImageWorkbench(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        # Only models are wired outside. Workbench state owns images/text/size.
        schema = copy.deepcopy(PH3ImageConditioning.define_schema())
        schema.node_id = "ComfyUIH3ImageWorkbench"
        schema.display_name = "闲兔H3生图工作台"
        schema.category = "闲兔/图片素材"
        schema.description = "P-H3 / H3-IMAGE 的官方条件与 Latent，连接对应模型和画布采样链。"
        schema.inputs = [
            io.Clip.Input("clip"),
            io.Vae.Input("vae", optional=True),
            io.Clip.Input("prompt_upsampler", lazy=True, optional=True, tooltip="优化开启时才执行此模型分支；关闭时跳过。"),
            io.String.Input("project_name", default="H3生图工程"),
            io.String.Input("workbench_state", default="{}", multiline=True),
            io.String.Input("h3_image_state", default="", multiline=True, optional=True),
        ]
        schema.outputs = [*schema.outputs, io.String.Output(display_name="文件名", tooltip="连接保存图片节点的文件名前缀。")]
        return schema

    @classmethod
    def check_lazy_status(cls, workbench_state="{}", h3_image_state="", prompt_upsampler=_MISSING, **_kwargs):
        _state, _shot, task = _active_task(h3_image_state or workbench_state)
        enabled = (task.get("generateText") or {}).get("enabled", False)
        return ["prompt_upsampler"] if enabled and prompt_upsampler is None else []

    @classmethod
    def execute(cls, clip, prompt_upsampler=None, vae=None,
                project_name="H3生图工程", workbench_state="{}", h3_image_state=""):
        del project_name
        is_h3_image = bool(h3_image_state)
        state, shot, task = _active_task(h3_image_state or workbench_state)
        prompt = task.get("prompt", "")
        width, height = state.get("width", 1024), state.get("height", 1024)
        mode = task.get("generationMode", state.get("generationMode", "文生图"))
        records = (task.get("referenceImages") or []) if mode == "图生图" else []
        if mode == "图生图" and not records:
            raise ValueError("当前分镜选择图生图，请在工作台内上传图片")
        limit = 16 if is_h3_image else 9
        if len(records) > limit:
            raise ValueError(f"当前模型最多使用 {limit} 张参考图，请在工作台内调整")
        images = {}
        for index, record in enumerate(records):
            name = str(record.get("name") or record.get("filename") or "").replace("\\", "/")
            subfolder = str(record.get("subfolder") or "").replace("\\", "/")
            relative = str(PurePosixPath(subfolder) / name)
            source_type = str(record.get("type") or "input")
            if source_type not in {"input", "output", "temp"}:
                raise ValueError("工作台参考图类型无效")
            annotation = "" if source_type == "input" else f" [{source_type}]"
            _report_execution("读取参考图", f"{index + 1}/{len(records)} · {PurePosixPath(name).name}")
            image, _mask = nodes.LoadImage().load_image(relative + annotation)
            images[f"image_{index+1}"] = image
        generated, reasoning = None, ""
        if is_h3_image:
            if vae is None:
                raise ValueError("请连接 H3-IMAGE 的 VAE")
            if not prompt.strip():
                raise ValueError("请填写 H3-IMAGE 提示词")
            result, prompt, generated, reasoning = _h3_image_conditioning(
                clip, vae, prompt_upsampler, state, task, prompt, images,
            )
        elif (task.get("generateText") or {}).get("enabled", False):
            if prompt_upsampler is None:
                raise ValueError("请连接 prompt_upsampler（官方提示词优化模型 CLIP）")
            textgen_images = {f"image{i+1}": image for i, image in enumerate(images.values())}
            _report_execution("优化提示词中")
            text = TextGenerateV2.execute(
                clip=prompt_upsampler, prompt=prompt,
                max_length=1536, sampling_mode={"sampling_mode": "off"},
                thinking=True, use_default_template=True, mtp="auto", system_prompt="",
                images=textgen_images,
            )
            generated, reasoning = text.args
            prompt = generated
        if not is_h3_image:
            _report_execution("编码生成条件中")
            result = PH3ImageConditioning.execute(
                clip=clip, prompt=prompt, width=width, height=height, vae=vae, images=images,
            )
        # Only UI metadata is added; conditioning / latent objects pass through.
        return io.NodeOutput(*result.args, _filename_prefix(state), ui={
            "h3_prompt": [prompt], "h3_generated_text": [generated],
            "h3_thinking": [reasoning], "h3_task_id": [task.get("id", "")],
            "h3_shot_id": [shot.get("id", "")],
        })


NODE_CLASS_MAPPINGS = {"ComfyUIH3ImageWorkbench": ComfyUIH3ImageWorkbench}
NODE_DISPLAY_NAME_MAPPINGS = {"ComfyUIH3ImageWorkbench": "闲兔H3生图工作台"}
