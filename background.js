const TOGGLE_KEY = 'enabled';
const API_KEY_KEY = 'gemini_api_key';
const REPORT_STRUCTURE_KEY = 'report_structure';

async function fetchArrayBuffer(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`Fetch failed ${res.status}`);
    return await res.arrayBuffer();
}

async function analyzeWithGemini({ fileUrl, fileName, context = {} }) {
    const { [API_KEY_KEY]: apiKey } = await chrome.storage.sync.get(API_KEY_KEY);
    if (!apiKey) throw new Error('NO_API_KEY');

    // Fetch the file with sanity checks
    const res = await fetch(fileUrl, { credentials: 'omit' });
    if (!res.ok) throw new Error(`FETCH_FILE_${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    const arrayBuf = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);
    if (bytes.byteLength < 1000) {
        throw new Error('FILE_TOO_SMALL');
    }
    if (/text\/html/i.test(contentType)) {
        throw new Error('FILE_IS_HTML');
    }

    // For simplicity, convert to base64 and send as a single-part input to Gemini 1.5 text API
    const b64 = arrayBufferToBase64(arrayBuf);

    const prompt = await buildContextualPrompt(context);

    // Log debug info for direct file analysis
    console.group('🔍 Mix Helper Direct File Debug');
    console.log('📝 Final prompt:', prompt);
    console.log('📄 File name:', fileName);
    console.log('📋 Context:', context);
    console.groupEnd();

    const mime = guessMimeFromName(fileName) || 'application/octet-stream';
    const supportedInlineMimes = new Set([
        'application/pdf',
        'text/plain',
        'text/markdown'
    ]);
    if (!supportedInlineMimes.has(mime)) {
        throw new Error(`UNSUPPORTED_MIME:${mime}`);
    }

    const body = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    {
                        inline_data: {
                            mime_type: mime,
                            data: b64
                        }
                    }
                ]
            }
        ]
    };

    return await generateWithCandidates(apiKey, body);
}

function guessMimeFromName(name = '') {
    const lower = String(name).toLowerCase();
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.doc')) return 'application/msword';
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.txt')) return 'text/plain';
    if (lower.endsWith('.md')) return 'text/markdown';
    return null;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

async function buildContextualPrompt(context) {
    // Get custom report structure if exists
    const { [REPORT_STRUCTURE_KEY]: customStructure } = await chrome.storage.sync.get(REPORT_STRUCTURE_KEY);

    let prompt = 'Проаналізуй звіт студента і надай структурований звіт у наступному форматі:\n\n';

    if (customStructure && customStructure.trim()) {
        // Use custom structure
        prompt += customStructure.trim();
    } else {
        // Use default structure
        prompt += 'ПЕРЕВІРЕНІ ФАЙЛИ:\n[список файлів, які були проаналізовані]\n\n';
        prompt += 'ОЦІНКА ВИКОНАННЯ: [відсоток від 0% до 100%]\n\n';
        prompt += 'ВІДПОВІДНІСТЬ ЗАВДАННЮ: [опис]\n\n';
        prompt += 'ВИЯВЛЕНІ ПОМИЛКИ:\n[список основних помилок, до 5 пунктів]\n\n';
        prompt += 'РЕКОМЕНДАЦІЇ:\n[поради щодо покращення, до 3 пунктів]\n\n';
        prompt += 'ЗАГАЛЬНИЙ ВИСНОВОК: [короткий висновок]';
    }

    prompt += '\n\nНа початку звіту напиши: "Звіт сформовано за допомогою AI Gemini"\n\n';

    if (context.taskTitle) {
        prompt += `\n\nНАЗВА ЗАВДАННЯ: ${context.taskTitle}`;
    }

    if (context.description) {
        prompt += `\n\nОПИС ЗАВДАННЯ:\n${context.description}`;
    }

    prompt += `\n\nВАЖЛИВО: Порівняй звіт студента з методичними вказівками та вимогами завдання. Перевір, чи виконані всі пункти завдання, чи відповідають результати вимогам.`;

    // Додаємо спеціальну інструкцію для критеріїв оцінювання
    prompt += `\n\nКРИТИЧНО ВАЖЛИВО: Якщо в описі завдання є розділ "Критерії оцінювання", "Оцінювання" або "Максимальна кількість балів", обов'язково використовуй ці критерії для визначення відсотка виконання.

ПРИКЛАДИ КРИТЕРІЇВ ОЦІНЮВАННЯ:
1. Завдання з відмітками (*, **, ***):
   - Завдання з відміткою або якщо виконаний мінімальний обсяг роботи, вказаний в завданні «*» = 60-73% балів
   - Завдання з відмітками «*» + «**» = 74-89% балів  
   - Завдання з відмітками «*» + «**» + «***» = 90-100% балів

2. Балова система (наприклад, "Максимальна кількість балів - 3 бали"):
   - Повне виконання всіх вимог = 100%
   - Часткове виконання = відповідний відсоток

3. Інші критерії:
   - Зарахований бал може бути зменшений за затримку = врахуй це
   - Відповідність методичним вказівкам = Бажано але не обов'язково, перевір

4. Якщо в описі завдання є розділ "Критерії оцінювання", "Оцінювання" або "Максимальна кількість балів", обов'язково використовуй ці критерії для визначення відсотка виконання.

АЛГОРИТМ ОЦІНЮВАННЯ:
1. Знайди критерії оцінювання в описі завдання
2. Проаналізуй, які завдання виконав студент (з якими відмітками/вимогами)
3. Визнач відповідний діапазон балів згідно з критеріями
4. Врахуй якість виконання та відповідність вимогам
5. Постав фінальну оцінку в межах діапазону

ЗАВЖДИ обґрунтуй свою оцінку посиланням на конкретні критерії з завдання.`;

    if (context.files && context.files.length > 0) {
        prompt += `\n\nМЕТОДИЧНІ ВКАЗІВКИ ДОСТУПНІ ДЛЯ АНАЛІЗУ:`;
        context.files.forEach((file, i) => {
            prompt += `\n${i + 1}. ${file.title || file.filename || 'Файл'}`;
        });
        prompt += `\n\nЦі файли будуть проаналізовані разом зі звітом студента для порівняння.`;
    }

    return prompt;
}

async function generateWithCandidates(apiKey, body) {
    const modelCandidates = [
        // 3.5
        { ver: 'v1',     id: 'gemini-3.5-flash' },
        { ver: 'v1beta', id: 'gemini-3.5-flash' },
        // 3.1
        { ver: 'v1beta', id: 'gemini-3.1-pro-preview' },
        { ver: 'v1',     id: 'gemini-3.1-flash-lite' },
        { ver: 'v1beta', id: 'gemini-3.1-flash-lite' },
        // 3.0
        { ver: 'v1beta', id: 'gemini-3-pro-preview' },
        { ver: 'v1beta', id: 'gemini-3-flash-preview' },
        // 2.5
        { ver: 'v1',     id: 'gemini-2.5-pro' },
        { ver: 'v1beta', id: 'gemini-2.5-pro' },
        { ver: 'v1',     id: 'gemini-2.5-flash-lite' },
        { ver: 'v1beta', id: 'gemini-2.5-flash-lite' },
        { ver: 'v1',     id: 'gemini-2.5-flash-latest' },
        { ver: 'v1beta', id: 'gemini-2.5-flash-latest' },
        { ver: 'v1',     id: 'gemini-2.5-flash' },
        { ver: 'v1beta', id: 'gemini-2.5-flash' },
        { ver: 'v1',     id: 'gemini-2.5-flash-001' },
        { ver: 'v1beta', id: 'gemini-2.5-flash-001' },
        // 2.0
        { ver: 'v1',     id: 'gemini-2.0-flash' },
        { ver: 'v1beta', id: 'gemini-2.0-flash' }
    ];

    let lastErrText = '';
    for (const m of modelCandidates) {
        const endpoint = `https://generativelanguage.googleapis.com/${m.ver}/models/${m.id}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (resp.ok) {
            const json = await resp.json();
            return json?.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || 'Немає відповіді';
        }
        lastErrText = await resp.text();
    }
    try {
        const parsed = JSON.parse(lastErrText);
        const msg = parsed?.error?.message || lastErrText || 'unknown error';
        throw new Error(`GEMINI_ERROR: ${msg}`);
    } catch (_) {
        throw new Error(`GEMINI_ERROR: ${lastErrText || 'unknown error'}`);
    }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'mix-analyze') {
        (async () => {
            try {
                const { [TOGGLE_KEY]: enabled = true } = await chrome.storage.sync.get(TOGGLE_KEY);
                if (!enabled) throw new Error('DISABLED');

                const result = await analyzeWithGemini({
                    fileUrl: msg.fileUrl,
                    fileName: msg.fileName,
                    context: msg.context || {}
                });
                sendResponse({ ok: true, summary: result });
            } catch (e) {
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true; // async
    }
    if (msg?.type === 'mix-analyze-parts') {
        (async () => {
            try {
                const { [TOGGLE_KEY]: enabled = true } = await chrome.storage.sync.get(TOGGLE_KEY);
                if (!enabled) throw new Error('DISABLED');

                const parts = Array.isArray(msg.parts) ? msg.parts : [];
                if (parts.length === 0) throw new Error('NO_PARTS');

                const context = msg.context || {};
                const prompt = await buildContextualPrompt(context);
                const body = { contents: [{ parts: [{ text: prompt }, ...parts] }] };

                console.group('🔍 Mix Helper Background Debug');
                console.log('📝 Final prompt:', prompt);
                console.log('📁 Parts being sent:', parts.length);
                console.log('📋 Context:', context);
                console.log('🔗 Body structure:', JSON.stringify(body, null, 2));
                console.groupEnd();

                const { [API_KEY_KEY]: apiKey } = await chrome.storage.sync.get(API_KEY_KEY);
                if (!apiKey) throw new Error('NO_API_KEY');

                const output = await generateWithCandidates(apiKey, body);
                sendResponse({ ok: true, summary: output });
            } catch (e) {
                console.error('🔍 Error in mix-analyze-parts:', e);
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true;
    }
    if (msg?.type === 'mix-test') {
        (async () => {
            try {
                const { [API_KEY_KEY]: apiKey } = await chrome.storage.sync.get(API_KEY_KEY);
                if (!apiKey) throw new Error('NO_API_KEY');

                const body = {
                    contents: [
                        { parts: [ { text: 'Відповідай коротко одним словом: OK' } ] }
                    ]
                };

                const output = await generateWithCandidates(apiKey, body);
                sendResponse({ ok: true, summary: output });
            } catch (e) {
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true;
    }
    if (msg?.type === 'mix-list-models') {
        (async () => {
            try {
                const { [API_KEY_KEY]: apiKey } = await chrome.storage.sync.get(API_KEY_KEY);
                if (!apiKey) throw new Error('NO_API_KEY');
                const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
                const resp = await fetch(endpoint);
                if (!resp.ok) {
                    const text = await resp.text();
                    try {
                        const j = JSON.parse(text);
                        throw new Error(j?.error?.message || text);
                    } catch {
                        throw new Error(text);
                    }
                }
                const json = await resp.json();
                const names = (json?.models || []).map(m => m.name).slice(0, 50);
                sendResponse({ ok: true, models: names });
            } catch (e) {
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true;
    }
    if (msg?.type === 'mix-fetch-arraybuffer') {
        (async () => {
            try {
                const res = await fetch(msg.url, { credentials: 'omit' });
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(`FETCH_${res.status}:${text.slice(0,200)}`);
                }
                const buf = await res.arrayBuffer();
                const b64 = arrayBufferToBase64(buf);
                sendResponse({ ok: true, base64: b64, contentType: res.headers.get('content-type') || '' });
            } catch (e) {
                sendResponse({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true;
    }
});
