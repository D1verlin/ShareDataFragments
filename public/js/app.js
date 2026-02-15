// --- ELEMENT REFS ---
const textarea = document.getElementById('editing-textarea');
const highlighting = document.getElementById('highlighting-content');
const btnBurn = document.getElementById('btn-burn');
const btnSave = document.getElementById('btn-save');
const fileInput = document.getElementById('file-upload');
const statusMsg = document.getElementById('status-msg');
const charCount = document.getElementById('char-count');
const btnCopy = document.getElementById('btn-copy');

const btnMd = document.getElementById('btn-md');
const mdPreview = document.getElementById('markdown-preview');
const dropZone = document.getElementById('drop-zone');

// --- STATE ---
let isBurn = false;
let isMdMode = false;
// Значения по умолчанию
let currentLang = 'text';
let currentTtl = 'never';

// --- CUSTOM SELECT LOGIC ---
function setupCustomSelect(dropdownId, initialValue, onChange) {
    const container = document.getElementById(dropdownId);
    if (!container) return;

    const trigger = container.querySelector('.select-trigger');
    const textSpan = container.querySelector('.selected-text');
    const options = container.querySelectorAll('.option');

    // Клик по триггеру (открыть/закрыть)
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        // Закрываем другие селекты если есть
        document.querySelectorAll('.custom-select').forEach(el => {
            if (el !== container) el.classList.remove('open');
        });
        container.classList.toggle('open');
    });

    // Клик по опции
    options.forEach(opt => {
        // Устанавливаем начальное состояние
        if (opt.dataset.value === initialValue) {
            opt.classList.add('selected');
            textSpan.textContent = opt.textContent;
        }

        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            // Убираем активный класс у всех
            options.forEach(o => o.classList.remove('selected'));
            // Ставим текущему
            opt.classList.add('selected');
            
            // Обновляем текст и значение
            textSpan.textContent = opt.textContent;
            const val = opt.dataset.value;
            container.classList.remove('open');
            
            // Вызываем коллбек
            onChange(val);
        });
    });
}

// Инициализация селектов
setupCustomSelect('lang-dropdown', 'text', (val) => {
    currentLang = val;
    highlighting.className = `language-${val}`;
    updateHighlighting();
});

setupCustomSelect('ttl-dropdown', 'never', (val) => {
    currentTtl = val;
});

// Закрытие меню при клике вне
document.addEventListener('click', () => {
    document.querySelectorAll('.custom-select').forEach(el => el.classList.remove('open'));
});


// --- HIGHLIGHTING ---
function updateHighlighting() {
    let text = textarea.value;
    charCount.textContent = `${text.length} chars`;
    
    if(text[text.length-1] == "\n") text += " ";
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    
    if (window.Prism && currentLang !== 'text') {
        highlighting.innerHTML = Prism.highlight(text, Prism.languages[currentLang] || Prism.languages.text, currentLang);
    } else {
        highlighting.innerHTML = text;
    }
}

textarea.addEventListener('input', updateHighlighting);
textarea.addEventListener('scroll', () => {
    highlighting.parentElement.scrollTop = textarea.scrollTop;
    highlighting.parentElement.scrollLeft = textarea.scrollLeft;
});

// --- IMPORT FILE ---
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        textarea.value = e.target.result;
        updateHighlighting();
        statusMsg.textContent = `Imported: ${file.name}`;
    };
    reader.readAsText(file);
});

// --- BURN TOGGLE ---
btnBurn.onclick = () => {
    isBurn = !isBurn;
    btnBurn.style.opacity = isBurn ? '1' : '0.5';
    btnBurn.textContent = isBurn ? '🔥 Burn: ON' : '🔥 Burn: OFF';
};

// --- MARKDOWN TOGGLE ---
btnMd.onclick = () => {
    isMdMode = !isMdMode;
    
    if (isMdMode) {
        const text = textarea.value;
        if (window.marked) {
            mdPreview.innerHTML = marked.parse(text);
            mdPreview.style.display = 'block';
            btnMd.style.background = 'var(--accent)';
            btnMd.style.color = 'var(--bg)';
            highlighting.style.opacity = '0';
            textarea.style.opacity = '0';
        } else {
            alert('Marked.js library not loaded');
            isMdMode = false;
        }
    } else {
        mdPreview.style.display = 'none';
        btnMd.style.background = '';
        btnMd.style.color = '';
        highlighting.style.opacity = '1';
        textarea.style.opacity = '1';
        textarea.focus();
    }
};

// --- DRAG & DROP ---
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, e => {
        e.preventDefault(); e.stopPropagation();
    }, false);
});

['dragenter', 'dragover'].forEach(eventName => {
    document.body.addEventListener(eventName, () => dropZone.classList.add('drag-active'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    document.body.addEventListener(eventName, () => dropZone.classList.remove('drag-active'), false);
});

document.body.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
        const file = files[0];
        if (file.type.startsWith('text') || file.name.match(/\.(js|json|html|css|py|md|txt|sql|sh)$/i)) {
            const reader = new FileReader();
            reader.onload = (e) => {
                textarea.value = e.target.result;
                updateHighlighting();
                statusMsg.textContent = `Dropped: ${file.name}`;
                if(file.name.toLowerCase().endsWith('.md')) statusMsg.textContent += ' (Markdown)';
            };
            reader.readAsText(file);
        } else {
            alert('Only text files supported');
        }
    }
}, false);

// --- SAVE ---
btnSave.onclick = async () => {
    const content = textarea.value;
    if (!content) return;

    if (btnSave.textContent === 'FORK') {
        // Логика новой пасты
    } else {
        btnSave.textContent = 'SAVING...';
    }
    
    try {
        const res = await fetch('/api/paste', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                content,
                language: currentLang, // Используем переменную
                burn: isBurn,
                ttl: currentTtl        // Используем переменную
            })
        });
        const data = await res.json();
        if (data.success) {
            window.location.href = data.url;
        }
    } catch (e) {
        alert('Error saving');
        btnSave.textContent = 'SAVE';
    }
};

// --- COPY ---
const originalCopyIcon = btnCopy.innerHTML;
const checkIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

btnCopy.onclick = async () => {
    const text = textarea.value;
    if (!text) return;
    try {
        await navigator.clipboard.writeText(text);
        btnCopy.innerHTML = checkIcon;
        btnCopy.style.borderColor = 'var(--accent)';
        statusMsg.textContent = 'Copied to clipboard!';
        setTimeout(() => {
            btnCopy.innerHTML = originalCopyIcon;
            btnCopy.style.borderColor = '';
            updateStatus();
        }, 2000);
    } catch (err) {
        console.error('Failed to copy!', err);
    }
};

function updateStatus() {
     const expiresData = statusMsg.getAttribute('data-expires');
     statusMsg.textContent = expiresData ? `Expires: ${expiresData}` : 'Ready';
}

// --- LOAD PASTE ---
const path = window.location.pathname;
if (path.length > 1) {
    loadPaste(path.substring(1));
}

async function loadPaste(id) {
    try {
        const res = await fetch(`/api/paste/${id}`);
        if (!res.ok) throw new Error('Not found');
        const data = await res.json();
        
        textarea.value = data.content;
        
        // Обновляем визуальное состояние кастомного селекта языка
        updateSelectUI('lang-dropdown', data.language);
        currentLang = data.language; // Важно обновить переменную!
        
        highlighting.className = `language-${data.language}`;
        updateHighlighting();
        
        document.title = `Paste / ${id}`;
        btnSave.textContent = 'FORK';
        btnSave.onclick = () => { window.location.href = '/'; };
        document.getElementById('btn-new').style.display = 'flex';
        document.getElementById('btn-new').onclick = () => window.location.href = '/';
        
        if (data.expires_at) {
            const date = new Date(data.expires_at).toLocaleString();
            statusMsg.textContent = `Expires: ${date}`;
            statusMsg.setAttribute('data-expires', date);
        }
    } catch (e) {
        textarea.value = "// 404: Paste not found or expired.";
        updateHighlighting();
    }
}

// Хелпер для обновления UI селекта при загрузке пасты
function updateSelectUI(id, value) {
    const container = document.getElementById(id);
    if(!container) return;
    const options = container.querySelectorAll('.option');
    const textSpan = container.querySelector('.selected-text');
    
    options.forEach(opt => {
        if(opt.dataset.value === value) {
            opt.classList.add('selected');
            textSpan.textContent = opt.textContent;
        } else {
            opt.classList.remove('selected');
        }
    });
}

// --- TELEPORT ---
const btnTeleport = document.getElementById('btn-teleport');
let ws;
btnTeleport.onclick = () => {
    document.getElementById('qr-modal').style.display = 'flex';
    if (!ws) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        ws = new WebSocket(`${protocol}//${window.location.host}`);
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            if (data.type === 'session_created') {
                const img = document.createElement('img');
                img.src = data.qr;
                img.style.width = '200px';
                document.getElementById('qr-target').innerHTML = '';
                document.getElementById('qr-target').appendChild(img);
            }
            if (data.type === 'incoming_text') {
                textarea.value = textarea.value + (textarea.value ? "\n" : "") + data.text;
                updateHighlighting();
                document.getElementById('qr-modal').style.display = 'none';
                statusMsg.textContent = "Data received via Teleport";
            }
        };
        ws.onopen = () => ws.send(JSON.stringify({ type: 'create_session' }));
    } else if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'create_session' }));
    }
};