const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

console.log('🚀 Versailles Hotel Bot - Ready for Deployment!');

// --- Hotel Info ---
const HOTEL = {
  name: 'فندق فرساي',
  address: 'صنعاء - شارع حدة - أمام سوبر ماركت الجندول',
  phone: '774333788',
  phone2: '014333788',
  website: 'versailleshotelapartments.netlify.app',
  rooms: [
    { name: 'الملكية', day: '35,000', month: '22,000' },
    { name: 'المميزة', day: '30,000', month: '17,000' },
    { name: 'الفاخرة', day: '28,000', month: '16,000' },
    { name: 'الاقتصادية', day: '25,000', month: '13,000' }
  ]
};

// --- Conversation Storage ---
const conversations = {};

function addMessage(phone, role, content) {
  if (!conversations[phone]) {
    conversations[phone] = { history: [], lastActivity: null };
  }
  conversations[phone].history.push({
    role,
    content,
    timestamp: new Date().toISOString()
  });
  conversations[phone].lastActivity = new Date().toISOString();
}

// --- AI Response ---
async function getAIResponse(messages, userName) {
  const apiKey = process.env.GROQ_API_KEY;
  const conversation = messages.join('\n');

  const prompt = `أنت مساعد فندق فرساي. رد بالعربية SHORT (سطر أو سطرين فقط).

الأسعار اليومية ← الشهرية:
- الملكية: 35,000 ← 22,000
- المميزة: 30,000 ← 17,000
- الفاخرة: 28,000 ← 16,000
- الاقتصادية: 25,000 ← 13,000

المحادثة: ${conversation}
العميل: ${userName}

rules:
1. رد قصير جداً (2-3 أسطر فقط)
2. ودود + إيموجي
3. اختم: 774333788`;

  if (!apiKey || apiKey === 'ضع_مفتاحك_هنا') {
    return getFallbackResponse(conversation, userName);
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'أنت مساعد فندق فرساي. رد قصير.' },
          { role: 'user', content: prompt }
        ],
        max_tokens: 80,
        temperature: 0.7
      })
    });

    if (!response.ok) throw new Error('API Error');
    const data = await response.json();
    return data.choices[0].message.content.trim();
  } catch (error) {
    console.log('AI Error:', error.message);
    return getFallbackResponse(conversation, userName);
  }
}

function getFallbackResponse(text, name) {
  const msg = text.toLowerCase();

  if (/سعر|كم|تكلف/.test(msg)) {
    let r = '💰 اليوم ← الشهر:\n';
    HOTEL.rooms.forEach(room => {
      r += `${room.name}: ${room.day} ← ${room.month}\n`;
    });
    return r + `📞 ${HOTEL.phone}`;
  }

  if (/فين|وين|موقع/.test(msg)) {
    return `📍 ${HOTEL.address}\n📞 ${HOTEL.phone}`;
  }

  if (/شكر|thanks/.test(msg)) {
    return `العفو! 🙏 ${HOTEL.phone}`;
  }

  return `${name}، كيف أساعدك؟\n📞 ${HOTEL.phone}`;
}

// --- Pending Messages ---
const pending = {};
const RESPONSE_DELAY = 5000;

// --- WhatsApp Client ---
let qrCode = null;
let isConnected = false;
let client;

function createClient() {
  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './auth_info_baileys' }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking'
      ]
    }
  });

  client.on('qr', (qr) => {
    qrCode = qr;
    console.log('📱 QR Code generated! Scan from WhatsApp.');
  });

  client.on('ready', () => {
    console.log('✅✅ Bot Connected Successfully!');
    isConnected = true;
    qrCode = null;
  });

  client.on('authenticated', () => {
    console.log('🔐 Authenticated!');
  });

  client.on('auth_failure', (msg) => {
    console.log('❌ Auth Failure:', msg);
    isConnected = false;
  });

  client.on('disconnected', (reason) => {
    console.log('⚠️ Disconnected:', reason);
    isConnected = false;
    qrCode = null;
    console.log('🔄 Reconnecting in 5 seconds...');
    setTimeout(() => {
      client.destroy();
      createClient();
      client.initialize();
    }, 5000);
  });

  client.on('message', async (msg) => {
    if (msg.fromMe) return;

    const from = msg.from;
    const isGroup = from.includes('@g.us');
    if (isGroup) return;

    const body = msg.body;
    if (!body) return;

    const name = msg._data?.notifyName || 'ضيفنا';
    console.log(`\n💬 ${name}: ${body}`);

    addMessage(from, 'user', body);

    if (!pending[from]) {
      pending[from] = { messages: [], timer: null };
    }

    pending[from].messages.push(body);

    if (pending[from].timer) {
      clearTimeout(pending[from].timer);
    }

    console.log(`⏳ جاري الانتظار...`);

    pending[from].timer = setTimeout(async () => {
      console.log(`🤖 جاري الرد...`);

      const msgs = [...pending[from].messages];
      pending[from] = null;

      const reply = await getAIResponse(msgs, name);
      console.log(`🤖 ${reply.substring(0, 50)}...`);

      addMessage(from, 'bot', reply);

      try {
        await client.sendMessage(from, reply);
        console.log('✅ تم!');
      } catch (err) {
        console.log('❌ خطأ:', err.message);
      }
    }, RESPONSE_DELAY);
  });
}

// --- Express Server ---
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- API Routes ---

app.get('/api/status', (req, res) => {
  res.json({
    status: isConnected ? 'connected' : (qrCode ? 'qr_ready' : 'disconnected'),
    hasQR: !!qrCode
  });
});

app.get('/api/qr', (req, res) => {
  if (qrCode) {
    res.json({ qr: qrCode });
  } else {
    res.json({ qr: null, message: 'Already connected or no QR' });
  }
});

app.get('/api/conversations', (req, res) => {
  const list = Object.entries(conversations).map(([phone, data]) => ({
    phone,
    lastMessage: data.history.length > 0 ? data.history[data.history.length - 1].content : '',
    lastActivity: data.lastActivity,
    messageCount: data.history.length
  }));
  list.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  res.json({ conversations: list });
});

app.get('/api/conversations/:phone', (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const conv = conversations[phone];
  if (!conv) {
    return res.json({ history: [] });
  }
  res.json({ history: conv.history });
});

app.post('/api/send', async (req, res) => {
  const { phone, message } = req.body;
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message required' });
  }
  if (!isConnected || !client) {
    return res.status(500).json({ error: 'Bot not connected' });
  }
  try {
    const jid = phone.includes('@') ? phone : `${phone}@c.us`;
    await client.sendMessage(jid, message);
    addMessage(jid, 'bot', message);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/restart', (req, res) => {
  res.json({ ok: true, message: 'Restarting...' });
  setTimeout(() => process.exit(0), 1000);
});

// --- Serve Dashboard ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Start ---
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`\n🌐 Dashboard: http://localhost:${PORT}\n`);
  console.log('📱 Scan QR from terminal or visit /api/qr\n');
  createClient();
  client.initialize();
});

process.on('SIGINT', () => {
  console.log('\n👋 Goodbye!');
  process.exit(0);
});
