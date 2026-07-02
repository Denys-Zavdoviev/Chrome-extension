const TOGGLE_KEY = 'enabled';

function onReady(callback) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        callback();
    } else {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
    }
}

(function() {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
        return originalFetch.apply(this, args).then(response => {
            if (response.ok) {
                response.clone().text().then(text => {
                    if (text.includes('"attachmenst"') || text.includes('"status"')) {
                        console.log('🔍 Found JSON in fetch response:', args[0], text.substring(0, 200) + '...');
                        try {
                            const candidate = JSON.parse(text);
                            if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {

                                window._foundTaskData = candidate;
                                console.log('🔍 Stored task data from fetch:', candidate);
                            }
                        } catch (e) {
                            console.log('🔍 Failed to parse fetch JSON:', e.message);
                        }
                    }
                }).catch(() => {});
            }
            return response;
        });
    };

})();

function createButton(text, id) {
    const button = document.createElement('button');
    button.textContent = text;
    button.id = id;
    button.className = 'mix-review-helper-btn';
    return button;
}

function injectButtons() {

    if (document.querySelector('#mix-btn-send')) return;

    const container = document.createElement('div');
    container.className = 'mix-review-helper-container';

    const title = document.createElement('h5');
    title.className = 'mix-review-helper-title';
    title.textContent = 'Огляд роботи через AI Gemini 🤖';
    container.appendChild(title);

    const sendBtn = createButton('Відправити на перевірку', 'mix-btn-send');
    container.appendChild(sendBtn);

    let target = document.querySelector('#comment-form .card-action');

    if (!target) {
        const actions = document.querySelectorAll('main .card-panel .card-action, .card-panel .card-action');
        if (actions && actions.length > 0) {
            target = actions[actions.length - 1];
        }
    }

    if (!target) {
        target = document.querySelector('main, #content, .content, #page, .container, body');
    }
    (target || document.body).appendChild(container);


    sendBtn.addEventListener('click', async () => {
        ensureResultPanel();
        setResult("🔄 Завантаження файлу...");
        try {
            const attachment = await findAttachment();
            console.log('🔍 Found attachment:', attachment);
            if (!attachment) {
                setResult('Не знайдено посилання на звіт (attachment).');
                return;
            }
            const name = attachment.title || attachment.filename || 'report.docx';
            const context = attachment.context || {};
            const allAttachments = attachment.allAttachments || [attachment];
            console.log('🔍 Attachment context:', context);
            console.log('🔍 All attachments:', allAttachments);


            const allParts = [];

            for (const att of allAttachments) {
                const attName = att.title || att.filename || att.url.split('/').pop() || 'file';
                const attUrl = att.url;


                if (/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(attName)) {
                    setResult(`🔄 Завантаження зображення: ${attName}...`);
                    try {
                        const fetched = await chrome.runtime.sendMessage({ type: 'mix-fetch-arraybuffer', url: attUrl });
                        if (fetched?.ok) {
                            allParts.push({
                                inline_data: {
                                    mime_type: getImageMimeType(attName),
                                    data: fetched.base64
                                }
                            });
                        }
                    } catch (e) {
                        console.warn('Failed to load image:', attName, e);
                    }
                } else if (/\.docx?$/i.test(attName) && window.mammoth) {
                    setResult("🔄 Конвертація DOCX...");
                    const docxParts = await convertDocxToParts(attUrl);
                    allParts.push(...docxParts);
                }
            }


            if (context.files && context.files.length > 0) {
                setResult("🔄 Завантаження методичних вказівок...");
                const taskParts = await convertTaskFiles(context.files);
                allParts.push(...taskParts);

                if (taskParts._processedFiles) {
                    context.processedTaskFiles = taskParts._processedFiles;
                }
                if (taskParts._skippedFiles && taskParts._skippedFiles.length > 0) {
                    context.skippedTaskFiles = taskParts._skippedFiles;
                }
            }

            if (allParts.length === 0) {

                setResult("🤖 Аналіз через AI...");
                const fallbackResp = await chrome.runtime.sendMessage({
                    type: 'mix-analyze',
                    fileUrl: attachment.url,
                    fileName: name,
                    context: context
                });
                if (fallbackResp?.ok) {
                    let resultText = "✅ Готово!\n\n";
                    if (context.processedTaskFiles && context.processedTaskFiles.length > 0) {
                        resultText += "📋 Проаналізовані методичні вказівки:\n";
                        context.processedTaskFiles.forEach((fileName, i) => {
                            resultText += `${i + 1}. ${fileName}\n`;
                        });
                        resultText += "\n";
                    } else if (context.files && context.files.length > 0) {
                        resultText += "📋 Проаналізовані методичні вказівки:\n";
                        context.files.forEach((file, i) => {
                            resultText += `${i + 1}. ${file.title || file.filename || 'Файл'}\n`;
                        });
                        resultText += "\n";
                    }
                    if (context.skippedTaskFiles && context.skippedTaskFiles.length > 0) {
                        resultText += "⚠️ Пропущені файли (невалідні або не підтримуються):\n";
                        context.skippedTaskFiles.forEach((fileName, i) => {
                            resultText += `${i + 1}. ${fileName}\n`;
                        });
                        resultText += "\n";
                    }
                    resultText += fallbackResp.summary || 'Порожня відповідь';
                    setResult(resultText);
                } else {
                    setResult('❌ Помилка: ' + (fallbackResp?.error || 'невідома'));
                }
                return;
            }

            setResult("🤖 Аналіз через AI...");

            // Log debug info before sending
            logDebugInfo('Will be sent to AI...', allParts, context);

            const resp = await chrome.runtime.sendMessage({
                type: 'mix-analyze-parts',
                parts: allParts,
                context: context
            });

            let resultText = "✅ Готово!\n\n";


            console.log('🔍 Context files:', context.files);
            if (context.processedTaskFiles && context.processedTaskFiles.length > 0) {
                resultText += "📋 Проаналізовані методичні вказівки:\n";
                context.processedTaskFiles.forEach((fileName, i) => {
                    resultText += `${i + 1}. ${fileName}\n`;
                });
                resultText += "\n";
            } else if (context.files && context.files.length > 0) {
                resultText += "📋 Проаналізовані методичні вказівки:\n";
                context.files.forEach((file, i) => {
                    resultText += `${i + 1}. ${file.title || file.filename || 'Файл'}\n`;
                });
                resultText += "\n";
            } else {
                console.log('🔍 No files found in context');
            }

            if (context.skippedTaskFiles && context.skippedTaskFiles.length > 0) {
                resultText += "⚠️ Пропущені файли (невалідні або не підтримуються):\n";
                context.skippedTaskFiles.forEach((fileName, i) => {
                    resultText += `${i + 1}. ${fileName}\n`;
                });
                resultText += "\n";
            }

            if (resp?.ok) {
                resultText += resp.summary || '';
                setResult(resultText);
            } else {
                setResult('❌ Помилка: ' + (resp?.error || 'невідома'));
            }
        } catch (e) {
            setResult('❌ Помилка: ' + (e?.message || e));
        }
    });
}

const observer = new MutationObserver(() => {
    injectButtons();
});

async function isEnabled() {
    return new Promise((resolve) => {
        try {
            chrome.storage.sync.get(TOGGLE_KEY, (res) => {
                resolve(res[TOGGLE_KEY] !== false); // default true
            });
        } catch (e) {
            resolve(true);
        }
    });
}

async function startIfEnabled() {
    const enabled = await isEnabled();
    if (!enabled) {

        const existing = document.querySelector('.mix-review-helper-container');
        if (existing) existing.remove();
        return;
    }
    injectButtons();
    observer.observe(document.documentElement, { childList: true, subtree: true });
}

onReady(() => {
    startIfEnabled();
});

try {
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg && msg.type === 'mix-helper-toggle') {
            if (msg.enabled) {
                startIfEnabled();
            } else {
                const existing = document.querySelector('.mix-review-helper-container');
                if (existing) existing.remove();
            }
        }
    });
} catch (e) {

}

async function findAttachment() {

    await new Promise(resolve => setTimeout(resolve, 1000));

    const scripts = Array.from(document.querySelectorAll('script'));
    let taskContext = null;


    const pageText = document.documentElement.innerHTML;
    console.log('🔍 Searching in page content for attachments...');
    console.log('🔍 Page contains "status":', /"status"/.test(pageText));
    console.log('🔍 Page contains "attachmenst":', /"attachmenst"/.test(pageText));
    console.log('🔍 Page contains "files":', /"files"/.test(pageText));

    console.log('🔍 Checking window for task data...');
    if (window.taskData) {
        console.log('🔍 Found window.taskData:', window.taskData);
        const candidate = window.taskData;
        if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {
            taskContext = {
                description: candidate.data?.description?.text || '',
                files: candidate.data?.description?.files || [],
                taskTitle: candidate.data?.task?.title || ''
            };
            console.log('🔍 Extracted taskContext from window:', taskContext);
            const result = buildAttachmentResult(candidate, taskContext);
            if (result) return result;
        }
    }


    if (window._foundTaskData) {
        console.log('🔍 Found window._foundTaskData:', window._foundTaskData);
        const candidate = window._foundTaskData;
        if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {
            taskContext = {
                description: candidate.data?.description?.text || '',
                files: candidate.data?.description?.files || [],
                taskTitle: candidate.data?.task?.title || ''
            };
            console.log('🔍 Extracted taskContext from fetch data:', taskContext);
            const result = buildAttachmentResult(candidate, taskContext);
            if (result) return result;
        }
    }


    if (window._manualTaskData) {
        console.log('🔍 Found window._manualTaskData:', window._manualTaskData);
        const candidate = window._manualTaskData;
        if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {
            taskContext = {
                description: candidate.data?.description?.text || '',
                files: candidate.data?.description?.files || [],
                taskTitle: candidate.data?.task?.title || ''
            };
            console.log('🔍 Extracted taskContext from manual data:', taskContext);
            const result = buildAttachmentResult(candidate, taskContext);
            if (result) return result;
        }
    }


    try {
        console.log('🔍 Trying to fetch JSON from .json endpoint...');
        const currentUrl = window.location.href;
        const jsonUrl = currentUrl.replace(/\/$/, '') + '.json';
        console.log('🔍 JSON URL:', jsonUrl);

        const response = await fetch(jsonUrl);
        if (response.ok) {
            const candidate = await response.json();
            console.log('🔍 Fetched JSON from endpoint:', candidate);

            if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {
                taskContext = {
                    description: candidate.data?.description?.text || '',
                    files: candidate.data?.description?.files || [],
                    taskTitle: candidate.data?.task?.title || ''
                };
                console.log('🔍 Extracted taskContext from JSON endpoint:', taskContext);
                const result = buildAttachmentResult(candidate, taskContext);
                if (result) return result;
            }
        } else {
            console.log('🔍 Failed to fetch JSON endpoint:', response.status, response.statusText);
        }
    } catch (e) {
        console.log('🔍 Error fetching JSON endpoint:', e.message);
    }


    console.log('🔍 Checking all script tags for JSON...');
    console.log('🔍 Total script tags found:', document.querySelectorAll('script').length);

    for (const script of document.querySelectorAll('script')) {
        const content = script.textContent || script.innerHTML;
        if (content && (content.includes('"status"') || content.includes('"attachmenst"'))) {
            console.log('🔍 Found potential JSON in script:', content.substring(0, 200) + '...');
            try {
                const candidate = JSON.parse(content);
                if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {
                    taskContext = {
                        description: candidate.data?.description?.text || '',
                        files: candidate.data?.description?.files || [],
                        taskTitle: candidate.data?.task?.title || ''
                    };
                    console.log('🔍 Extracted taskContext from script:', taskContext);
                    const result = buildAttachmentResult(candidate, taskContext);
                    if (result) return result;
                }
            } catch (e) {
                console.log('🔍 Failed to parse script JSON:', e.message);
            }
        }
    }


    console.log('🔍 Re-checking page content after delay...');
    const pageTextAfterDelay = document.documentElement.innerHTML;
    console.log('🔍 Page contains "status" after delay:', /"status"/.test(pageTextAfterDelay));
    console.log('🔍 Page contains "attachmenst" after delay:', /"attachmenst"/.test(pageTextAfterDelay));
    console.log('🔍 Page contains "files" after delay:', /"files"/.test(pageTextAfterDelay));


    const jsonMatches = pageTextAfterDelay.match(/\{[^{}]*"attachmenst"[^{}]*\}/g);
    if (jsonMatches) {
        console.log('🔍 Found JSON-like matches:', jsonMatches.length);
        for (const match of jsonMatches) {
            console.log('🔍 JSON match:', match.substring(0, 100) + '...');
        }
    }


    console.log('🔍 Checking for data attributes with JSON...');
    const allElements = document.querySelectorAll('*');
    for (const element of allElements) {
        for (const attr of element.attributes) {
            if (attr.name.startsWith('data-') && attr.value && (attr.value.includes('"attachmenst"') || attr.value.includes('"status"'))) {
                console.log('🔍 Found JSON in data attribute:', attr.name, attr.value.substring(0, 100) + '...');
                try {
                    const candidate = JSON.parse(attr.value);
                    if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {
                        taskContext = {
                            description: candidate.data?.description?.text || '',
                            files: candidate.data?.description?.files || [],
                            taskTitle: candidate.data?.task?.title || ''
                        };
                        console.log('🔍 Extracted taskContext from data attribute:', taskContext);
                        const result = buildAttachmentResult(candidate, taskContext);
                        if (result) return result;
                    }
                } catch (e) {
                    console.log('🔍 Failed to parse data attribute JSON:', e.message);
                }
            }
        }
    }


    console.log('🔍 Checking form elements for JSON...');
    const inputs = document.querySelectorAll('input[type="hidden"], textarea');
    for (const input of inputs) {
        if (input.value && (input.value.includes('"attachmenst"') || input.value.includes('"status"'))) {
            console.log('🔍 Found JSON in form element:', input.name || input.id, input.value.substring(0, 100) + '...');
            try {
                const candidate = JSON.parse(input.value);
                if (candidate.data?.attachmenst && Array.isArray(candidate.data.attachmenst) && candidate.data.attachmenst.length > 0) {
                    taskContext = {
                        description: candidate.data?.description?.text || '',
                        files: candidate.data?.description?.files || [],
                        taskTitle: candidate.data?.task?.title || ''
                    };
                    console.log('🔍 Extracted taskContext from form element:', taskContext);
                    const result = buildAttachmentResult(candidate, taskContext);
                    if (result) return result;
                }
            } catch (e) {
                console.log('🔍 Failed to parse form element JSON:', e.message);
            }
        }
    }

    for (const s of scripts) {
        const txt = s.textContent || '';
        if (!txt) continue;

        if (/attachmenst|attachments/.test(txt)) {
            console.log('🔍 Found script with attachments:', txt.substring(0, 200) + '...');
            const candidate = extractJsonObject(txt);
            console.log('🔍 Extracted candidate:', candidate);
            if (candidate) {
                const arr = candidate.attachmenst || candidate.attachments || candidate.data?.attachmenst || candidate.data?.attachments;
                if (Array.isArray(arr) && arr.length > 0 && arr[0].url) {

                    taskContext = {
                        description: candidate.data?.description?.text || '',
                        files: candidate.data?.description?.files || [],
                        taskTitle: candidate.data?.task?.title || ''
                    };
                    console.log('🔍 Extracted taskContext:', taskContext);
                    return {
                        url: absoluteUrl(arr[0].url),
                        title: arr[0].title || arr[0].filename,
                        context: taskContext
                    };
                }
            }
        }
    }


    if (/attachmenst.*files/.test(pageText) || /"status"\s*:\s*"Ok"/.test(pageText)) {
        console.log('🔍 Found attachments in page content, trying to extract...');
        const candidate = extractJsonObject(pageText);
        console.log('🔍 Extracted candidate from page:', candidate);
        if (candidate) {
            const arr = candidate.attachmenst || candidate.attachments || candidate.data?.attachmenst || candidate.data?.attachments;
            if (Array.isArray(arr) && arr.length > 0 && arr[0].url) {
                taskContext = {
                    description: candidate.data?.description?.text || '',
                    files: candidate.data?.description?.files || [],
                    taskTitle: candidate.data?.task?.title || ''
                };
                console.log('🔍 Extracted taskContext from page:', taskContext);
                return {
                    url: absoluteUrl(arr[0].url),
                    title: arr[0].title || arr[0].filename,
                    context: taskContext
                };
            }
        }
    }


    if (/"status"\s*:\s*"Ok"/.test(pageText)) {
        console.log('🔍 Found JSON with status Ok, trying to extract...');
        const statusIndex = pageText.indexOf('"status"');
        if (statusIndex !== -1) {
            let startIndex = statusIndex;
            while (startIndex > 0 && pageText[startIndex] !== '{') {
                startIndex--;
            }

            let braceCount = 0;
            let endIndex = startIndex;
            for (let i = startIndex; i < pageText.length; i++) {
                if (pageText[i] === '{') braceCount++;
                if (pageText[i] === '}') {
                    braceCount--;
                    if (braceCount === 0) {
                        endIndex = i;
                        break;
                    }
                }
            }

            if (braceCount === 0) {
                const jsonStr = pageText.slice(startIndex, endIndex + 1);
                console.log('🔍 Extracted JSON by status:', jsonStr.substring(0, 200) + '...');

                try {
                    const parsed = JSON.parse(jsonStr);
                    console.log('🔍 Successfully parsed JSON by status');
                    if (parsed.data?.attachmenst && Array.isArray(parsed.data.attachmenst) && parsed.data.attachmenst.length > 0) {
                        taskContext = {
                            description: parsed.data?.description?.text || '',
                            files: parsed.data?.description?.files || [],
                            taskTitle: parsed.data?.task?.title || ''
                        };
                        console.log('🔍 Extracted taskContext by status:', taskContext);
                        const result = buildAttachmentResult(parsed, taskContext);
                        if (result) return result;
                    }
                } catch (e) {
                    console.log('🔍 JSON parse failed by status:', e.message);
                }
            }
        }
    }

    console.log('🔍 Searching for any JSON-like content...');
    const allTextContent = document.body.innerText || document.body.textContent || '';
    if (allTextContent.includes('"attachmenst"') || allTextContent.includes('"status"')) {
        console.log('🔍 Found JSON-like content in text:', allTextContent.substring(0, 500) + '...');

        const jsonRegex = /\{[^{}]*(?:"attachmenst"|"status")[^{}]*\}/g;
        const matches = allTextContent.match(jsonRegex);
        if (matches) {
            console.log('🔍 Found JSON matches in text:', matches.length);
            for (const match of matches) {
                console.log('🔍 Text JSON match:', match.substring(0, 100) + '...');
                try {
                    const parsed = JSON.parse(match);
                    if (parsed.data?.attachmenst && Array.isArray(parsed.data.attachmenst) && parsed.data.attachmenst.length > 0) {
                        taskContext = {
                            description: parsed.data?.description?.text || '',
                            files: parsed.data?.description?.files || [],
                            taskTitle: parsed.data?.task?.title || ''
                        };
                        console.log('🔍 Extracted taskContext from text:', taskContext);
                        const result = buildAttachmentResult(parsed, taskContext);
                        if (result) return result;
                    }
                } catch (e) {
                    console.log('🔍 Failed to parse text JSON:', e.message);
                }
            }
        }
    }

    const links = Array.from(document.querySelectorAll('a[href]'));
    const blob = links.find(a => /mixsumdu\.blob\.core\.windows\.net/.test(a.href));
    if (blob) {
        const found = blob;
        return { url: found.href, title: found.getAttribute('download') || found.textContent?.trim() };
    }
    const semipub = links.find(a => /\/semipub\//.test(a.href));
    if (semipub) {
        return { url: semipub.href, title: semipub.getAttribute('download') || semipub.textContent?.trim() };
    }
    return null;
}

function extractJsonObject(text) {
    const attachmenstIndex = text.indexOf('"attachmenst"');
    if (attachmenstIndex === -1) return null;

    let startIndex = attachmenstIndex;
    while (startIndex > 0 && text[startIndex] !== '{') {
        startIndex--;
    }

    let braceCount = 0;
    let endIndex = startIndex;
    for (let i = startIndex; i < text.length; i++) {
        if (text[i] === '{') braceCount++;
        if (text[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
                endIndex = i;
                break;
            }
        }
    }

    if (braceCount !== 0) {
        console.log('🔍 Could not find matching braces');
        return null;
    }

    const jsonStr = text.slice(startIndex, endIndex + 1);
    console.log('🔍 Extracted JSON string:', jsonStr.substring(0, 200) + '...');

    try {
        const parsed = JSON.parse(jsonStr);
        console.log('🔍 Successfully parsed JSON');
        return parsed;
    } catch (e) {
        console.log('🔍 JSON parse failed:', e.message);
        return null;
    }
}

function absoluteUrl(u) {
    try { return new URL(u, location.href).href; } catch { return u; }
}

function getImageMimeType(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes = {
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp'
    };
    return mimeTypes[ext] || 'image/jpeg';
}

function buildAttachmentResult(candidate, taskContext) {

    const allAttachments = (candidate.data?.attachmenst || []).map(att => ({
        url: absoluteUrl(att.url),
        title: att.title || att.filename,
        filename: att.filename
    }));

    if (allAttachments.length > 0) {
        return {
            url: allAttachments[0].url,
            title: allAttachments[0].title || allAttachments[0].filename,
            allAttachments: allAttachments,
            context: taskContext
        };
    }
    return null;
}

function ensureResultPanel() {
    let panel = document.getElementById('mix-review-result');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'mix-review-result';
    panel.className = 'mix-review-helper-result';


    let target = document.querySelector('#comment-form .card-action');
    if (!target) {
        const actions = document.querySelectorAll('main .card-panel .card-action, .card-panel .card-action');
        if (actions && actions.length > 0) target = actions[actions.length - 1];
    }
    if (!target) target = document.querySelector('main, #content, .content, #page, .container, body');
    (target || document.body).appendChild(panel);
    return panel;
}

function setResult(text) {
    const panel = ensureResultPanel();
    const now = new Date();
    const dateTime = now.toLocaleString('uk-UA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });


    panel.contentEditable = 'true';
    panel.style.minHeight = '100px';
    panel.style.border = '1px solid';
    panel.style.borderImage = 'linear-gradient(45deg, #1C7AF6 0%, #8F68EA 33%, #E0767D 66%, #F6AC8A 100%) 1';
    panel.style.padding = '12px';
    // panel.style.borderRadius = '2px';
    panel.style.backgroundColor = '#ffffff';


    const header = document.createElement('div');
    header.style.fontSize = '11px';
    header.style.color = '#64748b';
    header.style.marginBottom = '8px';
    header.style.borderBottom = '1px solid';
    header.style.borderImage = 'linear-gradient(45deg, #1C7AF6 0%, #8F68EA 33%, #E0767D 66%, #F6AC8A 100%) 1';
    header.style.paddingBottom = '4px';
    header.textContent = `Створено: ${dateTime}`;
    header.contentEditable = 'false';


    panel.innerHTML = '';
    panel.appendChild(header);

    const content = document.createElement('div');
    content.contentEditable = 'true';
    content.style.outline = 'none';
    content.innerHTML = text.replace(/\n/g, '<br>');
    panel.appendChild(content);


    panel.contentEditable = 'true';
    header.contentEditable = 'false';
}

function logDebugInfo(prompt, parts, context) {
    console.group('🔍 Mix Helper Debug Info');
    console.log('📝 Prompt sent to AI:', prompt);
    console.log('📁 Parts count:', parts?.length || 0);
    if (parts && parts.length > 0) {
        parts.forEach((part, i) => {
            if (part.text) {
                console.log(`📄 Part ${i + 1} (text):`, part.text.substring(0, 200) + (part.text.length > 200 ? '...' : ''));
            } else if (part.inline_data) {
                console.log(`🖼️ Part ${i + 1} (image):`, part.inline_data.mime_type, 'size:', part.inline_data.data.length, 'chars');
            }
        });
    }
    console.log('📋 Context:', context);
    console.groupEnd();
}

async function convertDocxToParts(url) {

    const fetched = await chrome.runtime.sendMessage({ type: 'mix-fetch-arraybuffer', url });
    if (!fetched?.ok) throw new Error(fetched?.error || 'FETCH_FAILED');
    const buf = base64ToArrayBuffer(fetched.base64);
    const result = await mammoth.convertToHtml({ arrayBuffer: buf }, {
        convertImage: mammoth.images.inline(async element => element.read('base64').then(b64 => ({
            src: `data:${element.contentType};base64,${b64}`
        })))
    });
    const html = result.value || '';
    const text = htmlToPlain(html);
    const imageParts = extractImagesFromHtml(html).map(d => ({ inline_data: dataUrlToInline(d) }));
    const parts = [{ text }].concat(imageParts);
    return parts;
}

function htmlToPlain(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || '').replace(/\s+\n/g, '\n').trim();
}

function extractImagesFromHtml(html) {
    const container = document.createElement('div');
    container.innerHTML = html;
    const imgs = Array.from(container.querySelectorAll('img'));
    return imgs.map(img => img.getAttribute('src')).filter(Boolean).filter(s => s.startsWith('data:'));
}

function dataUrlToInline(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    if (!m) return { mime_type: 'image/png', data: '' };
    return { mime_type: m[1], data: m[2] };
}

function base64ToArrayBuffer(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary_string.charCodeAt(i);
    return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function isValidPDF(buffer) {

    if (!buffer || buffer.byteLength < 4) return false;
    const uint8Array = new Uint8Array(buffer);

    const header = String.fromCharCode(uint8Array[0], uint8Array[1], uint8Array[2], uint8Array[3]);
    return header === '%PDF';
}

function isHTMLContent(buffer) {

    if (!buffer || buffer.byteLength < 100) return false;
    const uint8Array = new Uint8Array(buffer);
    const text = String.fromCharCode(...uint8Array.slice(0, 100));
    return /<html|<HTML|<!DOCTYPE/i.test(text);
}

async function convertTaskFiles(files) {
    const taskParts = [];
    const processedFiles = [];
    const skippedFiles = [];

    for (const file of files) {
        try {
            setResult(`🔄 Завантаження: ${file.title || file.filename || 'файл'}...`);


            const fetched = await chrome.runtime.sendMessage({ type: 'mix-fetch-arraybuffer', url: file.url });
            if (!fetched?.ok) {
                console.warn('Failed to fetch task file:', file.url, fetched?.error);
                continue;
            }

            const buf = base64ToArrayBuffer(fetched.base64);
            const fileName = file.title || file.filename || 'task.pdf';
            const contentType = fetched.contentType || '';

            console.log('📄 Task file info:', {
                fileName,
                contentType,
                size: buf.byteLength,
                url: file.url
            });


            if (buf.byteLength < 100) {
                console.warn('Task file too small, skipping:', fileName, buf.byteLength);
                setResult(`⚠️ Файл ${fileName} занадто малий, пропущено`);
                continue;
            }


            if (/\.pdf$/i.test(fileName)) {

                if (isHTMLContent(buf)) {
                    console.warn('PDF file appears to be HTML (redirect?), skipping:', fileName);
                    setResult(`⚠️ Файл ${fileName} виглядає як HTML (можливо редирект), пропущено`);
                    continue;
                }
                if (!isValidPDF(buf)) {
                    console.warn('Invalid PDF file (missing PDF header), skipping:', fileName);
                    setResult(`⚠️ Файл ${fileName} не є валідним PDF, пропущено`);
                    continue;
                }

                console.log('✅ Valid PDF, adding to parts:', fileName);
                taskParts.push({
                    inline_data: {
                        mime_type: 'application/pdf',
                        data: fetched.base64
                    }
                });
                processedFiles.push(fileName);
            } else if (/\.docx?$/i.test(fileName) && window.mammoth) {
                // For DOCX, convert to text like report
                const docxResult = await mammoth.convertToHtml({ arrayBuffer: buf });
                const text = htmlToPlain(docxResult.value || '');
                taskParts.push({ text: `МЕТОДИЧНІ ВКАЗІВКИ (${fileName}):\n${text}` });
                processedFiles.push(fileName);
            } else {
                // For other files, try to extract text
                const text = await extractTextFromFile(buf, fileName);
                if (text) {
                    taskParts.push({ text: `МЕТОДИЧНІ ВКАЗІВКИ (${fileName}):\n${text}` });
                    processedFiles.push(fileName);
                } else {
                    skippedFiles.push(fileName);
                }
            }
        } catch (e) {
            console.warn('Error processing task file:', file.url, e);
            skippedFiles.push(file.title || file.filename || 'невідомий файл');
        }
    }


    taskParts._processedFiles = processedFiles;
    taskParts._skippedFiles = skippedFiles;

    return taskParts;
}

async function extractTextFromFile(buffer, fileName) {

    try {
        const uint8Array = new Uint8Array(buffer);
        const text = new TextDecoder('utf-8').decode(uint8Array);

        if (/^[\s\S]*[а-яА-Яa-zA-Z]{10,}[\s\S]*$/.test(text)) {
            return text.substring(0, 10000); // Limit to 10k chars
        }
    } catch (e) {
        // Ignore extraction errors
    }
    return null;
}
