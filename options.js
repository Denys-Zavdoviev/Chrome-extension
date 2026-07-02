const API_KEY_KEY = 'gemini_api_key';

document.addEventListener('DOMContentLoaded', async () => {
    const input = document.getElementById('apiKey');
    const { [API_KEY_KEY]: key } = await chrome.storage.sync.get(API_KEY_KEY);
    if (key) input.value = key;

    document.getElementById('save').addEventListener('click', async () => {
        const v = input.value.trim();
        try {
            await chrome.storage.sync.set({ [API_KEY_KEY]: v });
            const msg = document.getElementById('msg');
            msg.textContent = 'Збережено';
            msg.className = 'ok';
            setTimeout(() => { msg.textContent = ''; }, 2000);
        } catch (e) {
            const msg = document.getElementById('msg');
            msg.textContent = 'Помилка збереження';
            msg.className = 'err';
        }
    });
});
