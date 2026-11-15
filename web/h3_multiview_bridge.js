import {api} from '../../scripts/api.js';
const PLUGIN_ID="comfyui-character-multiview-workbench";
const PREVIOUS_CANVAS_RULE = '成图背景与排版：默认整张图使用统一纯白背景，包括分区间隙和人物脚下。若用户明确指定其他背景，请使用指定背景。角色参考图仅提供角色外观。所有留白保持干净，人物下方和各视图区不绘制文字、数字、坐标、标题、标签或水印。';
const MULTIVIEW_CANVAS_RULE = '成图背景与排版：默认整张图使用统一纯白背景，包括分区间隙和人物脚下。若用户明确指定其他背景，请使用指定背景。人物下方和各视图留白不绘制文字、数字、坐标、标题、标签或水印。';
const PANEL_COORDINATES = /；布局区域 x=([\d.]+), y=([\d.]+), w=([\d.]+), h=([\d.]+)$/;

export async function whiteModelReferences(image,result,upload,referenceLimit=9){
    const references=(image.referenceImages||[]).filter(record=>!record.xiantuMultiviewLayout);
    if(result.generationMode!=='图生图')return references;
    if(!result.whiteModelImage)throw new Error('未生成白模布局参考图，请刷新后重新应用');
    if(references.length>=referenceLimit)throw new Error(`当前已有 ${referenceLimit} 张角色参考图，请腾出 1 个位置给白模布局图`);
    const record=await upload(result.whiteModelImage);
    const layout={...record,xiantuMultiviewLayout:true};
    const headlessBody=result.settings?.headless&&result.settings.selected?.some(id=>['front','left_side','back'].includes(id));
    return headlessBody?[layout,...references]:[...references,layout];
}

export function formatH3MultiviewCanvas(result, references = [], modelProfile) {
    const block = result.settings?.appliedBlock;
    if (modelProfile !== 'H3-IMAGE' || typeof block !== 'string' || !block) return result;
    const start = result.prompt?.indexOf(block) ?? -1;
    if (start < 0) return result;

    const layoutIndex = result.generationMode === '图生图' ? references.findIndex(record => record.xiantuMultiviewLayout) : -1;
    const lines = block.split('\n').filter(line => line !== MULTIVIEW_CANVAS_RULE && line !== PREVIOUS_CANVAS_RULE).map(line => line.replace(
        PANEL_COORDINATES, (_, x, y, width, height) => {
            if (layoutIndex >= 0) return '';
            const centerX = Number(x) + Number(width) / 2;
            const centerY = Number(y) + Number(height) / 2;
            const horizontal = Number(width) >= 0.8 ? '' : centerX < 1 / 3 ? '左侧' : centerX > 2 / 3 ? '右侧' : '中间';
            const vertical = Number(height) >= 0.8 ? '' : centerY < 1 / 3 ? '上部' : centerY > 2 / 3 ? '下部' : '中部';
            const position = [vertical, horizontal].filter(Boolean).join('、');
            return position ? `；安排在画面${position}` : '';
        },
    ));
    const closing = lines.lastIndexOf('保留原始角色特征，不额外改变身份或配色。');
    lines.splice(closing < 0 ? lines.length : closing, 0, MULTIVIEW_CANVAS_RULE);
    const appliedBlock = lines.join('\n');
    return {
        ...result,
        prompt: result.prompt.slice(0, start) + appliedBlock + result.prompt.slice(start + block.length),
        settings: { ...result.settings, appliedBlock },
    };
}

export function applyCharacterMultiviewPrompt(result, references, modelProfile) {
    const block = result.settings?.appliedBlock;
    const layoutIndex = result.generationMode === '图生图' ? references.findIndex(record => record.xiantuMultiviewLayout) : -1;
    if (modelProfile !== 'H3-IMAGE' || layoutIndex < 0 || !block || !result.prompt?.endsWith(block)) {
        return formatH3MultiviewCanvas(result, references, modelProfile);
    }
    const characterIndex = references.findIndex(record => !record.xiantuMultiviewLayout);
    const characterSource = characterIndex < 0 ? '按用户对角色的文字描述确定体型' : `以 <Picture ${characterIndex+1}> 的角色本人为准，保持其脸、发型、服装和原有体型，延续原图未展示部位的自然比例`;
    const role = `分区与体型：<Picture ${layoutIndex+1}> 只提供分区位置、视角、取景范围和留白。${characterSource}。在每个分区重新绘制同一人物，保持肩宽、腰臀比例、头身比及躯干与四肢的比例一致。让人物自然地容纳在分区内，可以整体等比缩放，身体形态和轮廓以角色为准，保留适当留白。`;
    const lines = block.split('\n').filter(line => !line.startsWith('分区与体型：')
        && !line.startsWith('Replace the gray mannequins in <Picture 1>')
        && !line.startsWith('编辑任务：将 <Picture 1> 中各分区的人偶替换成')
        && !line.startsWith('最后一张参考图是灰白人偶布局图'));
    lines.splice(1, 0, role);
    const appliedBlock = lines.join('\n').replaceAll('主体在自己的布局区域内等比例尽量放大，仅保留少量安全边距，不跨区、不拉伸、不裁掉手脚',
        '保持人物原有体型，整体等比缩放以完整容纳于分区，留适当边距，不跨区、不拉伸、不裁切手脚');
    return formatH3MultiviewCanvas({
        ...result, prompt: result.prompt.slice(0, -block.length) + appliedBlock, settings: { ...result.settings, appliedBlock },
    }, references, modelProfile);
}

async function uploadWhiteModel(blob){
    const form=new FormData();form.append('image',blob,`multiview_layout_${crypto.randomUUID()}.png`);form.append('type','input');form.append('subfolder','h3_image_workbench/multiview_layout');form.append('overwrite','false');
    const response=await api.fetchApi('/upload/image',{method:'POST',body:form});
    const record=await response.json();if(!response.ok||!record.name)throw new Error(record.error||'白模布局图保存失败');
    return {name:record.name,subfolder:record.subfolder||'',type:record.type||'input'};
}

export function switchImageGenerationMode(image, mode) {
    const previousMode = image.generationMode === '图生图' ? '图生图' : '文生图';
    if (previousMode === mode) return false;
    image.promptDrafts ||= {};
    const references = image.referenceImages || [];
    const layoutIndex = references.findIndex(record => record.xiantuMultiviewLayout);
    image.promptDrafts[previousMode] = {
        prompt: image.prompt,
        characterMultiview: image.characterMultiview || {},
        ...(layoutIndex >= 0 ? { layoutReference: references[layoutIndex], layoutIndex } : {}),
    };
    const draft = image.promptDrafts[mode];
    delete image.promptDrafts[mode];
    image.generationMode = mode;
    image.prompt = String(draft?.prompt ?? '');
    image.characterMultiview = draft?.characterMultiview || {};
    image.referenceImages = references.filter(record => !record.xiantuMultiviewLayout);
    if (draft?.layoutReference?.xiantuMultiviewLayout) {
        image.referenceImages.splice(draft.layoutIndex, 0, draft.layoutReference);
    }
    return true;
}

export function mountCharacterMultiviewButton(root,state,getImage,save,refresh,notify,{referenceLimit,resolutionFor,canvasSize}){
    const button=document.createElement('button');button.type='button';button.textContent='角色多视图设置';
    root.querySelector('.h3iaw-shotbar').prepend(button);
    button.onclick=async()=>{
        const provider=globalThis.ComfyUICharacterMultiview;
        if(provider?.apiVersion!==1||provider?.pluginId!==PLUGIN_ID||typeof provider.open!=='function'){
            await notify('请安装并启用 ComfyUI-Character-Multiview-Workbench（闲兔角色多视图工作台），然后刷新页面。普通生图不受影响。','角色多视图插件未加载');return;
        }
        const shotId=state.activeShotId,target=getImage(),contextId=`${shotId}/${target.id}`;
        button.disabled=true;
        try{
            const {width,height}=await canvasSize(target);
            const resolutionOptions=Array.from(root.querySelector('[data-megapixels]')?.options||[]).map(option=>{
                const megapixels=Number(option.value);
                const size=resolutionFor(megapixels,state.aspect);
                return {label:`${megapixels} MP · ${size.width} × ${size.height}`,...size,megapixels};
            });
            if(!root.isConnected)return;
            const sourceMode = target.generationMode === '图生图' ? '图生图' : '文生图';
            const result=await provider.open({contextId,prompt:String(target.prompt||''),settings:structuredClone(target.characterMultiview||{}),generationMode:sourceMode,referenceImageCount:(target.referenceImages||[]).filter(record=>!record.xiantuMultiviewLayout).length,width,height,resolutionOptions});
            if(!result||!root.isConnected)return;
            const shot=state.shots.find(s=>s.id===shotId),image=shot?.images?.find(t=>t===target);
            if(!image||result.contextId!==contextId)throw new Error('原分镜已变化，未写入多视图设置');
            const references=await whiteModelReferences(image,result,uploadWhiteModel,referenceLimit);
            if(!root.isConnected)return;
            if(!state.shots.find(s=>s.id===shotId)?.images?.includes(image))throw new Error('原分镜已移除，未写入白模参考');
            if ((image.generationMode || '文生图') !== sourceMode) throw new Error('生成模式已切换，请重新应用多视图设置');
            const otherMode = ['文生图', '图生图'].includes(result.generationMode) && result.generationMode !== sourceMode;
            const application = otherMode ? {
                ...result,
                ...provider.createApplication(
                    image.promptDrafts?.[result.generationMode]?.prompt || '', result.settings,
                    result.resolution?.width || width, result.resolution?.height || height, result.generationMode,
                ),
            } : result;
            const applied=applyCharacterMultiviewPrompt(application,references,state.modelProfile);
            if (otherMode) switchImageGenerationMode(image, result.generationMode);
            image.prompt=String(applied.prompt);image.characterMultiview=structuredClone(applied.settings);
            image.referenceImages=references;
            if(result.resolution?.width>0&&result.resolution?.height>0&&Number.isFinite(result.resolution.megapixels)){
                state.width=result.resolution.width;state.height=result.resolution.height;state.megapixels=result.resolution.megapixels;
                if(state.modelProfile==='H3-IMAGE'&&(result.resolution.width!==width||result.resolution.height!==height))state.h3ImageMatchReference=false;
            }
            save();if(getImage()===image)refresh();
        }catch(error){await notify(String(error.message||error),'角色多视图设置');}
        finally{button.disabled=false;}
    };
}
