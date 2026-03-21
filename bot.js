require('dotenv').config();
const axios = require('axios');
const cron = require('node-cron');
const express = require('express');
const { RSI, ATR, BollingerBands } = require('technicalindicators');

// --- สร้างประตูหลอกให้ Railway สบายใจ (รัน 24/7) ---
const app = express();
app.get('/', (req, res) => res.send('ABLE Matemydaytrade Bot is running 24/7!'));
app.listen(process.env.PORT || 3000, () => {
    console.log('✅ Dummy Web Server is running');
});
// ------------------------------------------------

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const API_KEY = process.env.TWELVE_API_KEY;

// 1. ฟังก์ชันดึงข้อมูลจาก Twelve Data (เพิ่ม Open และ Volume)
async function fetchGoldData(interval) {
    try {
        // ขอข้อมูล 100 แท่ง เพื่อให้คำนวณค่าเฉลี่ย ATR 50 แท่งได้แม่นยำ
        const url = `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=${interval}&outputsize=100&apikey=${API_KEY}`;
        const response = await axios.get(url);
        
        if (response.data.status !== "ok") {
            console.error(`❌ API Error (${interval}):`, response.data.message);
            return null;
        }

        const values = response.data.values.reverse();
        return {
            open: values.map(v => parseFloat(v.open)),
            high: values.map(v => parseFloat(v.high)),
            low: values.map(v => parseFloat(v.low)),
            close: values.map(v => parseFloat(v.close)),
            volume: values.map(v => parseFloat(v.volume || 1)), // ป้องกันกรณีโบรกเกอร์ไม่ส่ง Volume มา
            currentPrice: parseFloat(values[values.length - 1].close)
        };
    } catch (error) {
        console.error(`❌ Fetch Error (${interval}):`, error.message);
        return null;
    }
}

// 2. ฟังก์ชันสมองกล ABLE Scoring System
function calculateABLEScore(data) {
    const { open, high, low, close, volume } = data;
    const currentIdx = close.length - 1;
    const prevIdx = close.length - 2;

    // --- คำนวณ Indicators ---
    const rsiList = RSI.calculate({ values: close, period: 14 });
    const currentRsi = rsiList[rsiList.length - 1];

    const atrList = ATR.calculate({ high, low, close, period: 14 });
    const currentAtr = atrList[atrList.length - 1];
    
    // หาค่าเฉลี่ย ATR 50 แท่ง
    const atr50 = atrList.slice(-50);
    const avgAtr = atr50.reduce((a, b) => a + b, 0) / atr50.length;

    const bbList = BollingerBands.calculate({ period: 20, values: close, stdDev: 2 });
    const currentBB = bbList[bbList.length - 1];

    // --- เริ่มให้คะแนน ---
    let score = 0;
    let details = []; // เก็บเหตุผลที่ได้คะแนน
    let sweepBuy = false;
    let sweepSell = false;
    let isCompression = false;
    let orderFlowBias = "NONE";

    // กฎที่ 1: Liquidity Sweep (+20 แต้ม)
    if (high[currentIdx] > high[prevIdx] && close[currentIdx] < high[prevIdx]) {
        sweepSell = true;
        score += 20;
        details.push("🧹 Liquidity Sweep (Top)");
    }
    if (low[currentIdx] < low[prevIdx] && close[currentIdx] > low[prevIdx]) {
        sweepBuy = true;
        score += 20;
        details.push("🧹 Liquidity Sweep (Bottom)");
    }

    // กฎที่ 2: Volatility Compression (+15 แต้ม)
    if (currentAtr < (avgAtr * 0.6)) {
        isCompression = true;
        score += 15;
        details.push("🗜️ Volatility Compression");
    }

    // กฎที่ 3: Order Flow Imbalance (+15 แต้ม) - ดูแรงซื้อขาย 5 แท่งล่าสุด
    let buyVol = 0; let sellVol = 0;
    for (let i = currentIdx - 4; i <= currentIdx; i++) {
        if (close[i] > open[i]) buyVol += volume[i];
        else sellVol += volume[i];
    }
    
    if (buyVol > sellVol * 1.5) {
        orderFlowBias = "BUY";
        score += 15;
        details.push("🌊 Order Flow (BUY)");
    } else if (sellVol > buyVol * 1.5) {
        orderFlowBias = "SELL";
        score += 15;
        details.push("🌊 Order Flow (SELL)");
    }

    // กฎที่ 4: RSI Extreme (+10 แต้ม)
    if (currentRsi < 30) {
        score += 10;
        details.push("📉 RSI Oversold");
    } else if (currentRsi > 70) {
        score += 10;
        details.push("📈 RSI Overbought");
    }

    // --- สรุปผลการยิง Signal ---
    let action = "NONE";
    // ปรับเกณฑ์คะแนนลงมาที่ 45 (เพราะเราขาดโมดูล Session & ABC Pattern แบบออริจินัล)
    if (score >= 45) {
        if (currentRsi <= 35 && sweepBuy && orderFlowBias !== "SELL") {
            action = "BUY";
        } else if (currentRsi >= 65 && sweepSell && orderFlowBias !== "BUY") {
            action = "SELL";
        }
    }

    return { action, score, currentRsi, details };
}

// 3. ฟังก์ชันหลักสำหรับตรวจสอบแต่ละ Timeframe
async function checkSignal(interval) {
    console.log(`⏳ [${new Date().toLocaleTimeString()}] Checking ABLE Logic [${interval}]...`);
    
    const data = await fetchGoldData(interval);
    if (!data) return;

    const analysis = calculateABLEScore(data);

    if (analysis.action !== "NONE") {
        sendTelegramSignal(analysis.action, data.currentPrice, analysis.currentRsi, analysis.score, analysis.details, interval);
    } else {
        console.log(`😴 [${interval}] Score: ${analysis.score}/100 - รอจังหวะเทรด...`);
    }
}

// 4. ฟังก์ชันส่ง Telegram (เพิ่ม Score และเหตุผล)
async function sendTelegramSignal(action, price, rsi, score, details, interval) {
    const emoji = action === "BUY" ? "🟢" : "🔴";
    
    const tp1 = action === "BUY" ? price + 3 : price - 3;
    const tp2 = action === "BUY" ? price + 6 : price - 6;
    const tp3 = action === "BUY" ? price + 10 : price - 10;
    const sl = action === "BUY" ? price - 5 : price + 5;

    // แปลง Array เหตุผลให้เป็นข้อความมี Bullet
    const reasonsText = details.length > 0 ? details.map(d => `• ${d}`).join('\n') : "• โครงสร้างราคาเข้าเงื่อนไข";

    const message = `
<b>|| ABLE GOLD ENGINE ||</b>
${emoji} <b>XAUUSD ${action}</b>   ${price.toFixed(2)}
⏱ <b>Timeframe:</b> ${interval}
🧠 <b>AI Score:</b> ${score} แต้ม

<b>TP¹</b>  ${tp1.toFixed(2)}
<b>TP²</b>  ${tp2.toFixed(2)}
<b>TP³</b>  ${tp3.toFixed(2)}
<b>SL</b>   ${sl.toFixed(2)}

<b>เหตุผลสนับสนุน:</b>
${reasonsText}

✨ ขอให้พอร์ตฟ้า กำไรปังๆ ครับ!
    `;

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        await axios.post(url, {
            chat_id: CHAT_ID,
            text: message,
            parse_mode: 'HTML'
        });
        console.log(`✅ ABLE Alert Sent: ${action} [${interval}] (Score: ${score})`);
    } catch (err) {
        console.error("❌ Telegram Error:", err.message);
    }
}

// ==========================================
// 🚀 เริ่มต้นการทำงาน (จันทร์ - ศุกร์)
// ==========================================
console.log("🚀 ABLE Matemydaytrade Bot Started!");

cron.schedule('*/5 * * * 1-5', () => checkSignal('5min'));
cron.schedule('*/15 * * * 1-5', () => checkSignal('15min'));
cron.schedule('0 * * * 1-5', () => checkSignal('1h'));
cron.schedule('0 */4 * * 1-5', () => checkSignal('4h'));