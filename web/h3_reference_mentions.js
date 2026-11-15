export function mountReferenceMentions(field, getReferences, fileUrl) {
    const menu = document.createElement("div");
    menu.className = "h3iaw-reference-mentions";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "选择参考图");
    menu.hidden = true;
    field.after(menu);

    let selected = 0;
    let trigger = null;
    const close = () => { menu.hidden = true; trigger = null; };
    const markSelected = () => {
        Array.from(menu.children).forEach((button, index) => button.classList.toggle("active", index === selected));
        menu.children[selected]?.scrollIntoView({ block: "nearest" });
    };
    const insert = (number) => {
        if (!trigger) return;
        field.setRangeText(`<Picture ${number}>`, trigger.start, trigger.end, "end");
        close();
        field.focus();
        field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const refresh = () => {
        const cursor = field.selectionStart;
        const match = field.value.slice(0, cursor).match(/(?:^|[^a-zA-Z0-9._%+\-@＠])([@＠])([^@＠\s<>]*)$/u);
        if (!match || cursor !== field.selectionEnd) { close(); return; }
        const query = match[2].toLocaleLowerCase();
        const references = getReferences().map((record, index) => ({ record, number: index + 1 })).filter(({ record, number }) => {
            if (/^\d+$/.test(query)) return String(number).startsWith(query);
            return `参考图 ${number} picture ${number} ${record.name || record.filename || ""}`.toLocaleLowerCase().includes(query);
        });
        if (!references.length) { close(); return; }
        trigger = { start: cursor - match[2].length - 1, end: cursor };
        selected = 0;
        const items = references.map(({ record, number }) => {
            const button = document.createElement("button");
            button.type = "button";
            const preview = document.createElement("img");
            preview.src = fileUrl(record);
            preview.alt = "";
            const label = document.createElement("span");
            label.textContent = `${record.xiantuMultiviewLayout ? "白模布局图" : "参考图"} ${number}`;
            const filename = document.createElement("small");
            filename.textContent = record.name || record.filename || "";
            label.append(filename);
            button.append(preview, label);
            button.onpointerdown = (event) => event.preventDefault();
            button.onclick = () => insert(number);
            return button;
        });
        menu.replaceChildren(...items);
        menu.hidden = false;
        markSelected();
    };
    field.addEventListener("input", (event) => { if (!event.isComposing) refresh(); });
    field.addEventListener("compositionend", refresh);
    field.addEventListener("click", refresh);
    field.addEventListener("blur", close);
    field.addEventListener("keyup", (event) => {
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refresh();
    });
    field.addEventListener("keydown", (event) => {
        if (menu.hidden || event.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const count = menu.childElementCount;
            selected = (selected + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            markSelected();
        } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            menu.children[selected]?.click();
        }
    });
    return close;
}
