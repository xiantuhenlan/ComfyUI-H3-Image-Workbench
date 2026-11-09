# ComfyUI-H3-Image-Workbench

工作台内标题为「闲兔H3生图工作台」；仓库、文件夹与发布主体名保持英文不变。

Independent ComfyUI image workbench using core p-h3-image Conditioning and Generate Text.

## Names

- Git repository / installation directory: `ComfyUI-H3-Image-Workbench`
- Registry package ID: `comfyui-h3-image-workbench`
- English display name: `ComfyUI-H3-Image-Workbench`
- Xiantu Launcher display name: `ComfyUI-H3-Image-Workbench（闲兔H3生图工作台）`
- Initial development version: `0.1.0`

## Current status

The copied node is now registered under its own ID, `ComfyUIH3ImageWorkbench`,
with its own frontend, asset library, hardware monitor and resource-cleanup routes.
See [INDEPENDENCE.md](INDEPENDENCE.md) for current runtime boundaries.
See [MOSS_COPY_BASELINE.md](MOSS_COPY_BASELINE.md) for the earlier unmodified-copy
baseline; that historical record is not the current activation status.

The node uses ComfyUI core `PH3ImageConditioning` with the same internal data
processing and two outputs: positive and Latent. Images, text and dimensions are
managed inside the workbench. The canvas only exposes the `clip`, `vae` and
`prompt_upsampler` model sockets and the open-workbench button. Core Generate Text
can optimize prompts using the reference workflow's parameters; original
and optimized prompts use navigation tabs. The original prompt is shown first;
the active task switches to the optimized-prompt tab when optimization finishes.
The optimization toggle beside the tabs defaults to off and is saved per task.
An explicitly saved enabled/disabled choice is retained. Double-clicking either
prompt textarea selects its entire contents, including text outside the viewport.
When off, raw text goes straight to conditioning and the connected upsampler input
is lazy, so that upstream model branch is not executed for this workbench.
There is no added auto-size option, parameter panel or thinking panel.
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
This is the initial 0.1.0 release. See [CHANGELOG.md](CHANGELOG.md).

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
Requires a ComfyUI core providing `PH3ImageConditioning` and `TextGenerateV2`,
plus appropriate p-h3-image models and a connected sampling/save workflow.

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
