"""Workbench adapter for ComfyUI core PH3ImageConditioning / TextGenerateV2."""
from __future__ import annotations
import copy
import json
from comfy_api.latest import io
from comfy_extras.nodes_minimax_h3 import PH3ImageConditioning
from comfy_extras.nodes_textgen import TextGenerateV2
from pathlib import PurePosixPath
import nodes

_MISSING = object()


def _active_task(raw):
    state = json.loads(raw or "{}")
    if not isinstance(state, dict):
        raise ValueError("工作台状态必须是 JSON 对象")
    shot = next((s for s in state.get("shots", []) if s.get("id") == state.get("activeShotId")), {})
    task = next((t for t in shot.get("images", []) if t.get("id") == shot.get("activeImageId")), {})
    return state, shot, task


class ComfyUIH3ImageWorkbench(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        # Only models are wired outside. Workbench state owns images/text/size.
        schema = copy.deepcopy(PH3ImageConditioning.define_schema())
        schema.node_id = "ComfyUIH3ImageWorkbench"
        schema.display_name = "闲兔H3生图工作台"
        schema.category = "闲兔/图片素材"
        schema.description = "p-h3-image 官方条件与 Latent；工作台内可使用官方 Generate Text。"
        schema.inputs = [
            io.Clip.Input("clip"),
            io.Vae.Input("vae", optional=True),
            io.Clip.Input("prompt_upsampler", lazy=True, optional=True, tooltip="优化开启时才执行此模型分支；关闭时跳过。"),
            io.String.Input("project_name", default="H3生图工程"),
            io.String.Input("workbench_state", default="{}", multiline=True),
        ]
        return schema

    @classmethod
    def check_lazy_status(cls, workbench_state="{}", prompt_upsampler=_MISSING, **_kwargs):
        _state, _shot, task = _active_task(workbench_state)
        enabled = (task.get("generateText") or {}).get("enabled", False)
        return ["prompt_upsampler"] if enabled and prompt_upsampler is None else []

    @classmethod
    def execute(cls, clip, prompt_upsampler=None, vae=None,
                project_name="H3生图工程", workbench_state="{}"):
        del project_name
        state, shot, task = _active_task(workbench_state)
        prompt = task.get("prompt", "")
        width, height = state.get("width", 1024), state.get("height", 1024)
        mode = task.get("generationMode", state.get("generationMode", "文生图"))
        records = (task.get("referenceImages") or []) if mode == "图生图" else []
        if mode == "图生图" and not records:
            raise ValueError("当前分镜选择图生图，请在工作台内上传图片")
        if len(records) > 9:
            raise ValueError("p-h3-image 最多使用 9 张图片，请在工作台内调整")
        images = {}
        for index, record in enumerate(records):
            name = str(record.get("name") or record.get("filename") or "").replace("\\", "/")
            subfolder = str(record.get("subfolder") or "").replace("\\", "/")
            relative = str(PurePosixPath(subfolder) / name)
            source_type = str(record.get("type") or "input")
            if source_type not in {"input", "output", "temp"}:
                raise ValueError("工作台参考图类型无效")
            annotation = "" if source_type == "input" else f" [{source_type}]"
            image, _mask = nodes.LoadImage().load_image(relative + annotation)
            images[f"image_{index+1}"] = image
        generated, reasoning = None, ""
        if (task.get("generateText") or {}).get("enabled", False):
            if prompt_upsampler is None:
                raise ValueError("请连接 prompt_upsampler（官方提示词优化模型 CLIP）")
            textgen_images = {f"image{i+1}": image for i, image in enumerate(images.values())}
            text = TextGenerateV2.execute(
                clip=prompt_upsampler, prompt=prompt,
                max_length=1536, sampling_mode={"sampling_mode": "off"},
                thinking=True, use_default_template=True, mtp="auto", system_prompt="",
                images=textgen_images,
            )
            generated, reasoning = text.args
            prompt = generated
        result = PH3ImageConditioning.execute(
            clip=clip, prompt=prompt, width=width, height=height, vae=vae, images=images,
        )
        # Only UI metadata is added; conditioning / latent objects pass through.
        return io.NodeOutput(*result.args, ui={
            "h3_prompt": [prompt], "h3_generated_text": [generated],
            "h3_thinking": [reasoning], "h3_task_id": [task.get("id", "")],
            "h3_shot_id": [shot.get("id", "")],
        })


NODE_CLASS_MAPPINGS = {"ComfyUIH3ImageWorkbench": ComfyUIH3ImageWorkbench}
NODE_DISPLAY_NAME_MAPPINGS = {"ComfyUIH3ImageWorkbench": "闲兔H3生图工作台"}
