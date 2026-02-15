const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const path = require('path');
const crypto = require('crypto');
const db = require('./database');
const cookieParser = require('cookie-parser');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- КОНФИГУРАЦИЯ ---
const ADMIN_PASSWORD = 'admin'; // Пароль для входа в /admin
const ADMIN_TOKEN = crypto.randomBytes(16).toString('hex'); // Токен сессии

const PORT = 3000;
// ⚠️ Ваш локальный IP. Убедитесь, что он не изменился.
const MY_IP = '192.168.0.161'; 

// --- MIDDLEWARE ---
// Увеличиваем лимит до 10MB для больших файлов
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser()); // Работа с куки для авторизации
app.use(express.static(path.join(__dirname, 'public')));

// Middleware: Проверка прав админа
const requireAdmin = (req, res, next) => {
    if (req.cookies['admin_session'] === ADMIN_TOKEN) {
        next();
    } else {
        res.redirect('/admin/login');
    }
};

// Middleware: Проверка бана по IP
const checkBan = async (req, res, next) => {
    // Получаем реальный IP
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    
    // Спрашиваем базу, забанен ли этот IP
    const isBanned = await db.isBanned(ip);
    
    if (isBanned) {
        return res.status(403).send('<h1>403 Forbidden</h1><p>Your IP has been banned by administrator.</p>');
    }
    next();
};

// Применяем проверку бана ко всем маршрутам создания контента
app.use('/api/paste', checkBan);
app.use('/api/ios-share', checkBan);

// --- ХЕЛПЕРЫ ---
function generateId() {
    return crypto.randomBytes(3).toString('hex').slice(0, 5);
}

function calculateExpiration(ttl) {
    if (!ttl || ttl === 'never') return null;
    const now = Date.now();
    switch (ttl) {
        case '10m': return now + 10 * 60 * 1000;
        case '1h':  return now + 60 * 60 * 1000;
        case '1d':  return now + 24 * 60 * 60 * 1000;
        case '1w':  return now + 7 * 24 * 60 * 60 * 1000;
        default: return null;
    }
}

// --- ОСНОВНОЕ API ---

// 1. Создание пасты
app.post('/api/paste', async (req, res) => {
    const content = req.body.content;
    const language = req.body.language || 'text';
    const burn = req.body.burn || false;
    const ttl = req.body.ttl || 'never'; 
    
    // Получаем IP создателя
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    if (!content || typeof content !== 'string') {
        return res.status(400).send('Empty content');
    }

    const id = generateId();
    const burnCount = burn ? 1 : 0;
    const expiresAt = calculateExpiration(ttl);

    try {
        // Передаем IP в базу данных
        await db.createPaste(id, content, language, burnCount, expiresAt, ip);
        
        const fullUrl = `http://${MY_IP}:${PORT}/${id}`;

        // Поддержка curl/wget (возвращаем только ссылку)
        const userAgent = req.get('User-Agent') || '';
        if (userAgent.includes('curl') || userAgent.includes('Wget')) {
            return res.send(fullUrl + '\n');
        }

        res.json({ success: true, url: `/${id}` });
    } catch (e) {
        console.error(e);
        res.status(500).send('Server Error: Check database structure');
    }
});

// 2. Чтение пасты
app.get('/api/paste/:id', async (req, res) => {
    try {
        const paste = await db.getPaste(req.params.id);

        if (!paste) return res.status(404).json({ error: 'Not found or expired' });

        // Если это "одноразовая" паста — удаляем после просмотра
        if (paste.burn_view_count === 1) {
            await db.deletePaste(paste.id);
        }

        res.json(paste);
    } catch (e) {
        res.status(500).json({ error: 'Database Error' });
    }
});

// 3. iOS Shortcuts (Share Sheet)
app.post('/api/ios-share', async (req, res) => {
    let content = req.body.content || req.body;
    
    // Парсинг JSON, если iOS отправил его некорректно как текст
    if (typeof content === 'object' && content.content) {
        content = content.content;
    }

    if (!content) return res.status(400).json({ error: 'No content' });

    const id = generateId();
    const expiresAt = calculateExpiration('1d'); // Дефолт: 1 день
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    try {
        await db.createPaste(id, content, 'text', 0, expiresAt, ip);
        const fullUrl = `http://${MY_IP}:${PORT}/${id}`;
        res.json({ success: true, url: fullUrl });
    } catch (e) {
        res.status(500).json({ error: 'Server Error' });
    }
});

// --- ADMIN ROUTES (PAGES) ---

app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/admin/auth', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        // Ставим куку на 24 часа
        res.cookie('admin_session', ADMIN_TOKEN, { httpOnly: true, maxAge: 86400000 });
        res.redirect('/admin');
    } else {
        res.redirect('/admin/login?error=1');
    }
});

app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- ADMIN API (DATA) ---

// Статистика
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        const stats = await db.getStats();
        res.json(stats);
    } catch (e) { res.status(500).json({error: 'Error'}); }
});

// Список всех паст
app.get('/api/admin/list', requireAdmin, async (req, res) => {
    try {
        const pastes = await db.getAllPastesAdmin();
        res.json(pastes);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// Чтение контента (raw) без удаления
app.get('/api/admin/raw/:id', requireAdmin, async (req, res) => {
    try {
        const content = await db.getPasteContentAdmin(req.params.id);
        if(!content) return res.status(404).send('Not found');
        res.send(content);
    } catch (e) { res.status(500).send('Error'); }
});

// Удаление
app.delete('/api/admin/delete/:id', requireAdmin, async (req, res) => {
    try {
        await db.deletePaste(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Error deleting' }); }
});

// Бан IP
app.post('/api/admin/ban', requireAdmin, async (req, res) => {
    const { ip } = req.body;
    try {
        await db.banIP(ip);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Error banning' }); }
});

app.get('/api/admin/banned', requireAdmin, async (req, res) => {
    try {
        const list = await db.getBannedIPs();
        res.json(list);
    } catch (e) { res.status(500).json({ error: 'DB Error' }); }
});

// Разбанить IP
app.post('/api/admin/unban', requireAdmin, async (req, res) => {
    const { ip } = req.body;
    try {
        await db.unbanIP(ip);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: 'Error unbanning' }); }
});

// --- PUBLIC PAGES ---
app.get('/teleport.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'teleport.html')));
app.get('/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// --- WEBSOCKETS (TELEPORT) ---
const sessions = new Map();

wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        let data;
        try { data = JSON.parse(message); } catch (e) { return; }

        // Создание сессии (ПК)
        if (data.type === 'create_session') {
            const sessionId = generateId();
            sessions.set(sessionId, ws);
            const mobileUrl = `http://${MY_IP}:${PORT}/teleport.html?session=${sessionId}`;
            const qrImage = await QRCode.toDataURL(mobileUrl);
            ws.send(JSON.stringify({ type: 'session_created', qr: qrImage }));
        }

        // Передача текста (Телефон -> ПК)
        if (data.type === 'teleport_text') {
            const targetSocket = sessions.get(data.sessionId);
            if (targetSocket) {
                targetSocket.send(JSON.stringify({ type: 'incoming_text', text: data.text }));
            }
        }
    });
    
    // Очистка памяти при разрыве соединения
    ws.on('close', () => {
        // В простой реализации Map очищается не сразу, можно добавить таймер
    });
});

// --- ЗАПУСК ---
server.listen(PORT, '0.0.0.0', () => {
    console.log(`⚫ NodeBin Monochrome running at http://${MY_IP}:${PORT}`);
    console.log(`🔑 Admin Panel: http://${MY_IP}:${PORT}/admin`);
});