const TOGGLE_KEY = 'enabled';
const API_KEY_KEY = 'gemini_api_key';
const REPORT_STRUCTURE_KEY = 'report_structure';

function updateIcon(isEnabled) {
    if (!chrome.action || !chrome.action.setIcon) return;
    const path = isEnabled ? {
        16: 'icons/icon16.png',
        48: 'icons/icon48.png',
        128: 'icons/icon128.png'
    } : {
        16: 'icons/icon16_off.png',
        48: 'icons/icon48_off.png',
        128: 'icons/icon128_off.png'
    };
    chrome.action.setIcon({ path });
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

document.addEventListener('DOMContentLoaded', async () => {
    const checkbox = document.getElementById('toggle');
    const { [TOGGLE_KEY]: enabled = true, [API_KEY_KEY]: apiKey, [REPORT_STRUCTURE_KEY]: structure } = await chrome.storage.sync.get([TOGGLE_KEY, API_KEY_KEY, REPORT_STRUCTURE_KEY]);
    checkbox.checked = Boolean(enabled);
    updateIcon(checkbox.checked);

    // Load API key if exists
    const apiKeyInput = document.getElementById('apiKey');
    if (apiKeyInput && apiKey) {
        apiKeyInput.value = apiKey;
    }

    // Load report structure if exists
    const structureTextarea = document.getElementById('reportStructure');
    if (structureTextarea && structure) {
        structureTextarea.value = structure;
    }

    checkbox.addEventListener('change', async () => {
        const isEnabled = checkbox.checked;
        await chrome.storage.sync.set({ [TOGGLE_KEY]: isEnabled });
        updateIcon(isEnabled);

        const tab = await getActiveTab();
        if (tab && tab.id) {
            chrome.tabs.sendMessage(tab.id, { type: 'mix-helper-toggle', enabled: isEnabled }).catch(() => {});
        }
    });

    const testBtn = document.getElementById('test');
    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            try {
                const resp = await chrome.runtime.sendMessage({ type: 'mix-test' });
                if (resp?.ok) {
                    alert('Gemini OK: ' + (resp.summary || ''));
                } else {
                    alert('Gemini ERROR: ' + (resp?.error || 'невідома'));
                }
            } catch (e) {
                alert('Gemini ERROR: ' + (e?.message || e));
            }
        });
    }

    const listBtn = document.getElementById('listModels');
    if (listBtn) {
        listBtn.addEventListener('click', async () => {
            try {
                const resp = await chrome.runtime.sendMessage({ type: 'mix-list-models' });
                if (resp?.ok) {
                    alert('Доступні моделі:\n' + (resp.models || []).join('\n'));
                } else {
                    alert('ListModels ERROR: ' + (resp?.error || 'невідома'));
                }
            } catch (e) {
                alert('ListModels ERROR: ' + (e?.message || e));
            }
        });
    }

    // Save API key
    const saveApiKeyBtn = document.getElementById('saveApiKey');
    if (saveApiKeyBtn) {
        saveApiKeyBtn.addEventListener('click', async () => {
            const apiKeyInput = document.getElementById('apiKey');
            const msgEl = document.getElementById('apiKeyMsg');
            if (apiKeyInput) {
                const key = apiKeyInput.value.trim();
                try {
                    await chrome.storage.sync.set({ [API_KEY_KEY]: key });
                    if (msgEl) {
                        msgEl.textContent = '✅ Збережено';
                        msgEl.style.color = '#16a34a';
                        setTimeout(() => { msgEl.textContent = ''; }, 2000);
                    }
                } catch (e) {
                    if (msgEl) {
                        msgEl.textContent = '❌ Помилка збереження';
                        msgEl.style.color = '#dc2626';
                    }
                }
            }
        });
    }

    // Save report structure
    const saveStructureBtn = document.getElementById('saveStructure');
    if (saveStructureBtn) {
        saveStructureBtn.addEventListener('click', async () => {
            const structureTextarea = document.getElementById('reportStructure');
            const msgEl = document.getElementById('structureMsg');
            if (structureTextarea) {
                const structure = structureTextarea.value.trim();
                try {
                    await chrome.storage.sync.set({ [REPORT_STRUCTURE_KEY]: structure || null });
                    if (msgEl) {
                        msgEl.textContent = structure ? '✅ Структура збережена' : '✅ Використовується стандартна структура';
                        msgEl.style.color = '#16a34a';
                        setTimeout(() => { msgEl.textContent = ''; }, 2000);
                    }
                } catch (e) {
                    if (msgEl) {
                        msgEl.textContent = '❌ Помилка збереження';
                        msgEl.style.color = '#dc2626';
                    }
                }
            }
        });
    }
});
