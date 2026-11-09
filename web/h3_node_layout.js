const modelInputs = {clip:"CLIP", vae:"VAE", prompt_upsampler:"CLIP"};
const parseState = value => {
    try { const state = typeof value === "string" ? JSON.parse(value) : null;
        return state && Array.isArray(state.shots) ? value : null;
    } catch { return null; }
};

export function repairWorkbenchNode(node, saved = null) {
    const named = saved?.widgets_values_named || {};
    const values = Array.isArray(saved?.widgets_values) ? saved.widgets_values : [];
    const stateValue = parseState(named.workbench_state)
        || parseState(saved?.properties?.h3ImageWorkbenchState)
        || parseState(node.properties?.h3ImageWorkbenchState)
        || values.map(parseState).find(Boolean)
        || parseState(node.widgets?.find(w=>w.name === "workbench_state")?.value)
        || "{}";
    const state = JSON.parse(stateValue);
    const project = named.project_name || state.projectName || "H3生图工程";
    // Removing only obsolete pins is intentional: do not reinterpret an old
    // negative CONDITIONING link as a LATENT link.
    for (let i=(node.inputs?.length || 0)-1;i>=0;i--)
        if (!Object.hasOwn(modelInputs,node.inputs[i].name)) node.removeInput(i);
    for (const [name,type] of Object.entries(modelInputs))
        if (!node.inputs?.some(input=>input.name===name)) node.addInput(name,type);
    for (let i=(node.outputs?.length || 0)-1;i>=2;i--) node.removeOutput(i);
    for (const [index,name,type] of [[0,"positive","CONDITIONING"],[1,"Latent","LATENT"]]) {
        if (!node.outputs?.[index]) node.addOutput(name,type);
        const output=node.outputs[index];
        if (output.type !== type) node.disconnectOutput?.(index);
        output.type=type;output.name=name;output.label=name;
    }
    node.widgets = (node.widgets || []).filter(w => ["project_name","workbench_state","打开H3生图工作台"].includes(w.name));
    for (const [name,value] of [["project_name",project],["workbench_state",stateValue]]) {
        let widget=node.widgets.find(w=>w.name===name);
        if (!widget) widget=node.addWidget("text",name,value,()=>{},{});
        widget.value=value;widget.type="converted-widget";widget.hidden=true;
        widget.computeSize=()=>[0,-4];widget.draw=()=>{};widget.mouse=()=>false;
        widget.serialize=true;widget.serializeValue=async()=>widget.value;
        if(widget.element)widget.element.style.display="none";
    }
    node.properties ||= {};
    node.properties.h3ImageWorkbenchState=stateValue;
    node.setDirtyCanvas?.(true,true);
}
