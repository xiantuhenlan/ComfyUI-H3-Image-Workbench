# ComfyUI-H3-Image-Workbench

从「闲兔H3生图工作台」节点打开 P-H3 或 H3-IMAGE 页面。

Independent ComfyUI image workbench with separate P-H3 and MiniMax H3-IMAGE pages.

## Names

- Git repository / installation directory: `ComfyUI-H3-Image-Workbench`
- Registry package ID: `comfyui-h3-image-workbench`
- English display name: `ComfyUI-H3-Image-Workbench`
- Xiantu Launcher display name: `ComfyUI-H3-Image-Workbench（闲兔H3生图工作台）`
- Release version: `0.1.1`

## Current status

The copied node is now registered under its own ID, `ComfyUIH3ImageWorkbench`,
with its own frontend, asset library, hardware monitor and resource-cleanup routes.
See [INDEPENDENCE.md](INDEPENDENCE.md) for current runtime boundaries.
See [MOSS_COPY_BASELINE.md](MOSS_COPY_BASELINE.md) for the earlier unmodified-copy
baseline; that historical record is not the current activation status.

The node uses the corresponding ComfyUI core conditioning for each model, with
`positive`, `Latent` and `文件名` outputs. Images, text and dimensions are
managed inside the workbench. The canvas exposes `clip`, `vae` and
`prompt_upsampler` model sockets and the open-workbench button. Core Generate Text
can optimize prompts using the reference workflow's parameters; original
and optimized prompts use navigation tabs. The original prompt is shown first;
the active task switches to the optimized-prompt tab when optimization finishes.
The optimization toggle beside the tabs defaults to off and is saved per task.
An explicitly saved enabled/disabled choice is retained. Double-clicking either
prompt textarea selects its entire contents, including text outside the viewport.
When off, raw text goes straight to conditioning and the connected upsampler input
is lazy, so that upstream model branch is not executed for this workbench.
The right sidebar is dedicated to prompt navigation and the full-height editor;
the previous template-category/search/free-creation block is not displayed.

“角色多视图设置”按钮可选调用独立插件
`ComfyUI-Character-Multiview-Workbench`。未安装时只提示缺少该扩展，不影响普通生图。
多视图界面、自由布局和收藏代码不在本插件内；点击应用后，把返回的提示词、设置和
图生图白模参考写回发起请求的分镜。只有用户主动选择并应用分辨率才更新尺寸。
不会反向导入该插件的 Python 代码。去头模式使用白模作为首张编辑底图，角色图作为
外观参考；普通模式仍保留角色图优先的顺序。该功能为实验性生成约束，不保证模型遵循。
The workbench UI is based on the earlier copied MOSS layout; it is no longer a
MOSS conditioning backend. There is no negative conditioning or placeholder IMAGE
output. CLIP, VAE, sampler and save nodes are supplied by the user's workflow.
It does not import any other custom-node plugin. The original plugin is unchanged.
See [CHANGELOG.md](CHANGELOG.md) for release changes. The filename output can be
connected to the filename prefix on the workflow's Save Image node.

Text-to-image and image-to-image are separate workbench modes. Only image mode
shows uploads and supplies the active task's stored images to both core stages;
switching to text mode keeps stored images but does not submit them. Mode is saved
per task. Old MOSS-era instances of this new node have their own layout repaired;
other plugins' nodes are not rewritten. It can be installed alongside the original.

## Metadata and publication

`pyproject.toml` carries the English ComfyUI display name and normalized package
ID. `plugin_manifest.json` carries the launcher-specific Chinese name suffix;
the launcher already reads this manifest before falling back to pyproject metadata.

GitHub: https://github.com/xiantuhenlan/ComfyUI-H3-Image-Workbench

Registry ID: `comfyui-h3-image-workbench`, publisher `xiantuhenlan`.
Install through the ComfyUI Manager/Registry or clone this repository into
`ComfyUI/custom_nodes/ComfyUI-H3-Image-Workbench`, install `requirements.txt`
in the ComfyUI Python environment, then restart ComfyUI and refresh the browser.
Requires the corresponding models and ComfyUI core nodes for the selected page.
P-H3 uses `PH3ImageConditioning`, H3-IMAGE uses `MiniMaxH3ImageConditioning`,
and optional prompt optimization uses `TextGenerateV2`.

The optional multiview integration is experimental: recent real-model tests did
not reliably preserve side views, remove body heads or transfer character appearance
onto the white-model layout. These outcomes are not certified fixed. No hidden
post-generation cropping or compositing is used to conceal model failures.

For future releases increment the semantic patch version by one, update the
changelog and publish both GitHub and Registry. This release is published directly;
automatic publishing is not enabled because the current GitHub login lacks workflow
write permission. `publish_action.example.yml` is a non-executing template: the
repository owner may install it at `.github/workflows/publish_action.yml` using an
appropriately authorized login. It uses the encrypted `REGISTRY_ACCESS_TOKEN`
secret. Do not overwrite an existing version.

Do not commit tokens, user assets, workflows, generated outputs or model files.

## P-H3 和 H3-IMAGE

在原工作台顶部选择模型。P-H3 保留现有工作流的 CLIP、VAE、提示词优化接线和已存工程。H3-IMAGE 在同一工作台的独立页面运行，分镜、提示词、参考图、模型选择和结果单独保存。H3-IMAGE 不使用 P-H3 画布的模型连接。

H3-IMAGE 内置官方文生图和图生图流程。支持 4 至 20 MP 输出预设，图生图支持按主参考图比例调整到约 4 MP 并按 32 像素对齐。最多 16 张参考图，可在提示词中用 `@` 选择，按顺序插入 `<Picture 1>`、`<Picture 2>` 等引用。支持可选的官方提示词扩写、分镜生成和主参考图与结果对比。默认保存目录为 `output/H3生图`。

在 H3-IMAGE 页展开「H3-IMAGE 模型文件」可刷新和选择本地文件。需要 MiniMax-H3-Image 扩散模型和 VAE、MiniMax H3 文本编码器；启用提示词优化时还需要 Qwen3.5 或 Qwen3.8 扩写模型。需要提供 MiniMaxH3ImageConditioning 的 ComfyUI，已针对 0.45.2 做流程验证。模型请参照 [官方图生图工作流](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_minimax_h3_image_edit.json) 和 [官方文生图工作流](https://github.com/Comfy-Org/workflow_templates/blob/main/templates/image_minimax_h3_image_t2i.json)。

当前发布版本：`0.1.4`。完整仓库与更新清单地址见 `plugin_manifest.json`。
