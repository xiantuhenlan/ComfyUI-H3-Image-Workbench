/*
MIT License

Copyright (c) 2023-present Comfy Org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// Prompt templates from Comfy-Org/workflow_templates (image_minimax_h3_image_edit and image_minimax_h3_image_t2i).
let officialPrompts;
export function loadH3ImageOfficialPrompts() {
    return officialPrompts ||= fetch(new URL("./h3_image_official_prompts.json", import.meta.url))
        .then(response => {
            if (!response.ok) throw new Error("无法读取 H3-IMAGE 官方提示词模板");
            return response.json();
        })
        .catch(error => {
            officialPrompts = null;
            throw error;
        });
}
