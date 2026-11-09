import {api} from '../../scripts/api.js';
const PLUGIN_ID="comfyui-character-multiview-workbench";

export async function whiteModelReferences(image,result,upload){
    const references=(image.referenceImages||[]).filter(record=>!record.xiantuMultiviewLayout);
    if(result.generationMode!=='图生图')return references;
    if(!result.whiteModelImage)throw new Error('未生成白模布局参考图，请刷新后重新应用');
    if(references.length>=9)throw new Error('当前已有9张角色参考图，请腾出1个位置给白模布局图；未删除任何参考图');
    const record=await upload(result.whiteModelImage);
    const layout={...record,xiantuMultiviewLayout:true};
    const headlessBody=result.settings?.headless&&result.settings.selected?.some(id=>['front','left_side','back'].includes(id));
    return headlessBody?[layout,...references]:[...references,layout];
}

async function uploadWhiteModel(blob){
    const form=new FormData();form.append('image',blob,`multiview_layout_${crypto.randomUUID()}.png`);form.append('type','input');form.append('subfolder','h3_image_workbench/multiview_layout');form.append('overwrite','false');
    const response=await api.fetchApi('/upload/image',{method:'POST',body:form});
    const record=await response.json();if(!response.ok||!record.name)throw new Error(record.error||'白模布局图保存失败');
    return {name:record.name,subfolder:record.subfolder||'',type:record.type||'input'};
}

const modeUpdates=new WeakMap();
export async function updateCharacterMultiviewMode(image,state){
    const provider=globalThis.ComfyUICharacterMultiview,settings=image.characterMultiview;
    const prompt=String(image.prompt||''),block=settings?.appliedBlock;
    const ticket={};modeUpdates.set(image,ticket);
    if(provider?.apiVersion!==1||provider?.pluginId!==PLUGIN_ID||typeof provider.createApplication!=='function'||!settings?.selected?.length)return false;
    const owned=(block&&(prompt===block||prompt.endsWith('\n\n'+block)))||(typeof provider.stripMultiviewBlocks==='function'&&provider.stripMultiviewBlocks(prompt)!==prompt.trimEnd());
    if(!owned)return false;
    const mode=image.generationMode;
    const result=provider.createApplication(prompt,structuredClone(settings),state.width,state.height,image.generationMode);
    result.generationMode=mode;
    if(mode==='图生图'){
        if(typeof provider.createWhiteModelImage!=='function')throw new Error('白模模块未完整加载，请刷新后重试');
        result.whiteModelImage=await provider.createWhiteModelImage(result.settings,state.width,state.height);
    }
    if(modeUpdates.get(image)!==ticket||image.generationMode!==mode)return false;
    const references=await whiteModelReferences(image,result,uploadWhiteModel);
    if(modeUpdates.get(image)!==ticket||image.generationMode!==mode)return false;
    image.prompt=result.prompt;image.characterMultiview=structuredClone(result.settings);image.referenceImages=references;
    return true;
}

export function mountCharacterMultiviewButton(root,state,getImage,save,refresh,notify){
    const button=document.createElement('button');button.type='button';button.textContent='角色多视图设置';
    root.querySelector('.h3iaw-shotbar').prepend(button);
    button.onclick=async()=>{
        const provider=globalThis.ComfyUICharacterMultiview;
        if(provider?.apiVersion!==1||provider?.pluginId!==PLUGIN_ID||typeof provider.open!=='function'){
            await notify('请安装并启用 ComfyUI-Character-Multiview-Workbench（闲兔角色多视图工作台），然后刷新页面。普通生图不受影响。','角色多视图插件未加载');return;
        }
        const shotId=state.activeShotId,target=getImage(),contextId=`${shotId}/${target.id}`;
        const resolutionOptions=Array.from(root.querySelector('[data-megapixels]')?.options||[]).flatMap(option=>{const match=option.textContent.match(/(\d+)\s*[×x]\s*(\d+)/);return match?[{label:option.textContent,width:Number(match[1]),height:Number(match[2]),megapixels:Number(option.value)}]:[];});
        button.disabled=true;
        try{
            const result=await provider.open({contextId,prompt:String(target.prompt||''),settings:structuredClone(target.characterMultiview||{}),generationMode:target.generationMode==='图生图'?'图生图':'文生图',referenceImageCount:(target.referenceImages||[]).filter(record=>!record.xiantuMultiviewLayout).length,width:state.width,height:state.height,resolutionOptions});
            if(!result)return;
            const shot=state.shots.find(s=>s.id===shotId),image=shot?.images?.find(t=>t===target);
            if(!image||result.contextId!==contextId)throw new Error('原分镜已变化，未写入多视图设置');
            const references=await whiteModelReferences(image,result,uploadWhiteModel);
            if(!state.shots.find(s=>s.id===shotId)?.images?.includes(image))throw new Error('原分镜已移除，未写入白模参考');
            image.prompt=String(result.prompt);image.characterMultiview=structuredClone(result.settings);
            image.referenceImages=references;
            if(result.generationMode==='文生图'||result.generationMode==='图生图')image.generationMode=result.generationMode;
            if(result.resolution?.width>0&&result.resolution?.height>0&&Number.isFinite(result.resolution.megapixels)){state.width=result.resolution.width;state.height=result.resolution.height;state.megapixels=result.resolution.megapixels;}
            save();if(getImage()===image)refresh();
        }catch(error){await notify(String(error.message||error),'角色多视图设置');}
        finally{button.disabled=false;}
    };
}
