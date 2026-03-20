require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// รับ Signal แบบ POST Request
app.post('/api/signal', async (req, res) => {
    try {
        const { symbol, action, price, tp1, tp2, tp3, sl, rsi } = req.body;

        // เช็คว่าข้อมูลมาครบไหม
        if (!symbol || !action || !price) {
            return res.status(400).send({ error: 'Missing signal data' });
        }

        const emoji = action.toUpperCase() === 'BUY' ? '🟢' : '🔴';
        
        // จัดฟอร์แมตข้อความแบบ HTML
        const message = `
<b>|| Matemydaytrade GOLD Fx ||</b>
${emoji} <b>${symbol} ${action.toUpperCase()}</b>   ${price}

<b>TP¹</b>  ${tp1}
<b>TP²</b>  ${tp2}
<b>TP³</b>  ${tp3}
<b>SL</b>   ${sl}

📊 สัญญาณ RSI (5m): ${rsi || '-'}
✨ ขอให้พอร์ตฟ้า กำไรปังๆ ครับ!
        `;

        const telegramUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
        
        // ยิงเข้า Telegram ด้วย POST + JSON (เสถียรกว่า GET)
        await axios.post(telegramUrl, {
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });

        console.log(`✅ [${new Date().toLocaleTimeString()}] Signal Sent: ${action} ${symbol}`);
        res.status(200).send({ status: 'success' });

    } catch (error) {
        console.error('❌ Error:', error.message);
        res.status(500).send({ error: 'Server error' });
    }
});

app.listen(process.env.PORT, () => {
    console.log(`🚀 Matemydaytrade Bot running on port ${process.env.PORT}`);
});