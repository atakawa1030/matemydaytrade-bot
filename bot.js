require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const { RSI, Stochastic } = require('technicalindicators');
const express = require('express');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_KEY = process.env.TWELVE_API_KEY;

const app = express();
app.get('/', (req, res) => res.send('Matemydaytrade Bot is running 24/7!'));
app.listen(process.env.PORT || 3000, () => {
    console.log('✅ Dummy Web Server is running');
});

// 1. ฟังก์ชันดึงข้อมูลแบบระบุ Timeframe (interval)
async function fetchGoldData(interval) {
    try {
        const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=50&apikey=${API_KEY}`;
        const response = await axios.get(url);
        
        if (response.data.status !== "ok") {
            console.error(`❌ API Error (${interval}):`, response.data.message);
            return null;
        }

        const values = response.data.values.reverse();
        return {
            close: values.map(v => parseFloat(v.close)),
            high: values.map(v => parseFloat(v.high)),
            low: values.map(v => parseFloat(v.low)),
            currentPrice: parseFloat(values[values.length - 1].close)
        };
    } catch (error) {
        console.error(`❌ Fetch Error (${interval}):`, error.message);
        return null;
    }
}

// 2. ฟังก์ชันตรวจสอบสัญญาณ โดยรับค่า Timeframe เข้ามา
async function checkSignal(interval) {
    console.log(`⏳ [${new Date().toLocaleTimeString()}] Checking XAUUSD [${interval}]...`);
    
    const data = await fetchGoldData(interval);
    if (!data) return;

    // คำนวณ RSI (14)
    const rsiResult = RSI.calculate({ values: data.close, period: 14 });
    const currentRsi = rsiResult[rsiResult.length - 1];

    // คำนวณ Stochastic (14, 3, 3)
    const stochResult = Stochastic.calculate({
        high: data.high, low: data.low, close: data.close,
        period: 14, signalPeriod: 3
    });
    
    const currentStoch = stochResult[stochResult.length - 1];
    const prevStoch = stochResult[stochResult.length - 2];

    let action = "NONE";

    // --- เงื่อนไขการเข้าเทรด Stoch Cross ---
    // BUY: %K ตัด %D ขึ้น ในโซน < 20
    if (prevStoch.k < prevStoch.d && currentStoch.k > currentStoch.d && currentStoch.k < 20) {
        action = "BUY";
    }
    // SELL: %K ตัด %D ลง ในโซน > 80
    else if (prevStoch.k > prevStoch.d && currentStoch.k < currentStoch.d && currentStoch.k > 80) {
        action = "SELL";
    }

    if (action !== "NONE") {
        sendTelegramSignal(action, data.currentPrice, currentRsi, currentStoch, interval);
    } else {
        console.log(`😴 [${interval}] ไม่มีสัญญาณเข้าเทรด`);
    }
}

// 3. ฟังก์ชันจัดรูปแบบและส่ง Telegram (เพิ่ม TP1, TP2, TP3, SL)
async function sendTelegramSignal(action, price, rsi, stoch, interval) {
    const emoji = action === "BUY" ? "🟢" : "🔴";
    
    // กำหนดระยะ TP และ SL (อิงตามทองคำ ระยะเหรียญ)
    // คุณสามารถแก้ตัวเลข 3, 6, 10, 5 ให้เป็นระยะจุดที่คุณต้องการได้ครับ
    let tp1, tp2, tp3, sl;
    if (action === "BUY") {
        tp1 = price + 3;  // บวก 300 จุด
        tp2 = price + 6;  // บวก 600 จุด
        tp3 = price + 10; // บวก 1000 จุด
        sl = price - 5;   // ลบ 500 จุด
    } else {
        tp1 = price - 3;
        tp2 = price - 6;
        tp3 = price - 10;
        sl = price + 5;
    }

    const message = `
<b>|| Matemydaytrade GOLD Fx ||</b>
${emoji} <b>XAUUSD ${action}</b>   ${price.toFixed(2)}
⏱ <b>Timeframe:</b> ${interval}

<b>TP¹</b>  ${tp1.toFixed(2)}
<b>TP²</b>  ${tp2.toFixed(2)}
<b>TP³</b>  ${tp3.toFixed(2)}
<b>SL</b>   ${sl.toFixed(2)}

📊 <b>RSI (14):</b> ${rsi.toFixed(2)}
📉 <b>Stoch:</b> %K=${stoch.k.toFixed(1)} / %D=${stoch.d.toFixed(1)}
✨ ขอให้พอร์ตฟ้า กำไรปังๆ ครับ!
    `;

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log(`✅ Telegram Alert Sent: ${action} [${interval}]`);
    } catch (err) {
        console.error("❌ Telegram Error:", err.message);
    }
}

// ==========================================
// 🚀 เริ่มต้นการทำงาน (ตั้งเวลา จันทร์ - ศุกร์)
// ==========================================
console.log("🚀 Matemydaytrade Auto-Signal Bot Started!");

// 1. เช็กกราฟ 5 นาที (ทุกๆ 5 นาที เฉพาะจันทร์-ศุกร์)
cron.schedule('*/5 * * * 1-5', () => {
    checkSignal('5min');
});

// 2. เช็กกราฟ 15 นาที (ทุกๆ 15 นาที เฉพาะจันทร์-ศุกร์)
cron.schedule('*/15 * * * 1-5', () => {
    checkSignal('15min');
});

// 3. เช็กกราฟ 1 ชั่วโมง (ต้นชั่วโมง เฉพาะจันทร์-ศุกร์)
cron.schedule('0 * * * 1-5', () => {
    checkSignal('1h');
});

// 4. เช็กกราฟ 4 ชั่วโมง (ทุกๆ 4 ชั่วโมง เฉพาะจันทร์-ศุกร์)
cron.schedule('0 */4 * * 1-5', () => {
    checkSignal('4h');
});