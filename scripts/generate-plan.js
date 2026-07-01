/**
 * 每日增肌食谱生成器（云端版）
 * 运行在 GitHub Actions，每天 12:00 CST 自动生成并推送到微信
 * 
 * 特性：
 * - 4 天轮换菜谱（基于参考日期偏移量，确定不随机）
 * - 训练感知调整（从云端读取训练计划）
 * - 完整推送内容（食材、做法、B站视频链接、营养信息）
 * - 方糖 Server酱 推送到微信
 */

const https = require("https");
const fs = require("fs");
const recipes = JSON.parse(fs.readFileSync("recipes.json", "utf-8"));
const SEND_KEY = process.env.SEND_KEY;

// ======= 工具函数 =======

function getTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  return {
    dateObj: d,
    dateStr: `${y}年${m}月${day}日`,
    short: `${y}-${m}-${day}`,
    weekDay: weekDays[d.getDay()],
    dayOfMonth: d.getDate()
  };
}

/**
 * 确定性的轮换索引：基于从参考日期起的天数差
 * 参考日期：2026-06-24（首次设置系统之日）
 * 这样每天固定，不随机，跨月不重置
 */
function getCycleIndex() {
  const REFERENCE = new Date("2026-06-24T00:00:00Z");
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const msDiff = tomorrow.getTime() - REFERENCE.getTime();
  const daysSinceRef = Math.floor(msDiff / 86400000);
  const idx = daysSinceRef % 4;
  return idx < 0 ? 0 : idx;
}

/**
 * 从云端读取训练计划
 * 尝试多个代理源
 */
async function getTrainingPlan() {
  const urls = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent("https://jsonblob.com/api/jsonBlob/019ef625-3d87-714a-843c-a8cb71086430")}`,
    "https://jsonblob.com/api/jsonBlob/019ef625-3d87-714a-843c-a8cb71086430"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        console.log("Cloud training plan fetched OK");
        return data;
      }
    } catch (e) {
      console.log(`Training plan fetch failed (${url}): ${e.message}`);
    }
  }
  console.log("No cloud training plan available, using default");
  return { plans: {} };
}

/**
 * 训练感知调整
 */
function getTrainingMod(training) {
  const mod = { proteinMod: 0, carbMod: 0, kcalMod: 0, emoji: "💪", note: "增肌训练日·均衡营养" };
  if (!training || training === "休息") {
    if (training === "休息") {
      mod.proteinMod = -5; mod.carbMod = -10; mod.kcalMod = -100;
      mod.emoji = "😴"; mod.note = "休息日·稍减热量·给肠胃放个假";
    }
    return mod;
  }
  if (training.includes("腿")) {
    mod.proteinMod = 5; mod.carbMod = 15; mod.kcalMod = 120;
    mod.emoji = "🦵"; mod.note = "练腿日·高碳水高蛋白·多吃多恢复";
  } else if (training.includes("胸")) {
    mod.proteinMod = 3; mod.carbMod = 8; mod.kcalMod = 60;
    mod.emoji = "🏋️"; mod.note = "练胸日·保证蛋白质·练后可加碳";
  } else if (training.includes("背")) {
    mod.proteinMod = 3; mod.carbMod = 8; mod.kcalMod = 60;
    mod.emoji = "🦅"; mod.note = "练背日·均衡蛋白碳·大肌群多补";
  } else if (training.includes("肩")) {
    mod.proteinMod = 2; mod.carbMod = 5; mod.kcalMod = 40;
    mod.emoji = "🔥"; mod.note = "练肩日·稳定营养·小肌群修复";
  } else if (training.includes("手") || training.includes("臂")) {
    mod.proteinMod = 2; mod.carbMod = 5; mod.kcalMod = 40;
    mod.emoji = "💪"; mod.note = "手臂日·高蛋白·侧重训练后补充";
  } else if (training.includes("有氧")) {
    mod.proteinMod = 2; mod.carbMod = 5; mod.kcalMod = 30;
    mod.emoji = "🏃"; mod.note = "有氧日·控制碳水·保持蛋白";
  }
  return mod;
}

/**
 * 生成加餐
 */
function getSnacks(training) {
  const snacks = [];
  if (training && training !== "休息") {
    snacks.push({ name: "训练后加餐：蛋白粉 1 勺 + 香蕉 1 根", kcal: 200, protein: 25 });
    if (training.includes("腿") || training.includes("背")) {
      snacks.push({ name: "额外加餐：希腊酸奶 200g + 坚果 20g", kcal: 250, protein: 15 });
    }
  }
  return snacks;
}

/**
 * 方糖推送
 */
function pushWeChat(title, content) {
  return new Promise((resolve, reject) => {
    if (!SEND_KEY) {
      console.log("No SEND_KEY configured, skipping WeChat push");
      resolve();
      return;
    }
    const postData = JSON.stringify({ title, desp: content });
    const req = https.request(
      `https://sctapi.ftqq.com/${SEND_KEY}.send`,
      { method: "POST", headers: { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(postData) } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            const result = JSON.parse(body);
            if (result.code === 0) {
              console.log("✅ WeChat push OK");
              resolve();
            } else {
              console.error("⚠️ Push returned non-zero:", result.message || result.info);
              resolve(); // non-fatal
            }
          } catch (e) {
            console.error("⚠️ Push response parse error:", body.slice(0, 200));
            resolve();
          }
        });
      }
    );
    req.on("error", (e) => {
      console.error("⚠️ Push network error:", e.message);
      resolve();
    });
    req.write(postData);
    req.end();
  });
}

/**
 * 格式化做法步骤
 */
function formatSteps(steps) {
  return steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
}

/**
 * 格式化食材列表
 */
function formatIngredients(ings) {
  return ings.map((i) => `${i.name}（${i.qty}）`).join("、");
}

async function main() {
  const tomorrow = getTomorrow();
  const cycleIdx = getCycleIndex();
  
  console.log(`Generating for: ${tomorrow.short} (${tomorrow.dateStr} ${tomorrow.weekDay})`);
  console.log(`Cycle index: ${cycleIdx}`);
  
  // 选菜谱
  const breakfast = recipes.breakfasts[cycleIdx];
  const lunch = recipes.lunches[cycleIdx];
  const dinner = recipes.dinners[cycleIdx];
  const dailyTip = recipes.tips[cycleIdx % recipes.tips.length];
  
  if (!breakfast || !lunch || !dinner) {
    console.error("Recipe data incomplete at cycle", cycleIdx);
    process.exit(1);
  }
  
  // 读取训练计划
  const plans = await getTrainingPlan();
  const plan = plans.plans?.[tomorrow.short];
  const training = (plan?.training || "").trim();
  const trainingNote = plan?.note || "";
  console.log(`Training: ${training || "无训练计划"}`);
  
  const mod = getTrainingMod(training);
  const snacks = getSnacks(training);
  
  // 计算营养
  let totalProtein = breakfast.protein + lunch.protein + dinner.protein + mod.proteinMod;
  let totalKcal = breakfast.kcal + lunch.kcal + dinner.kcal + mod.kcalMod;
  let snackProtein = 0, snackKcal = 0;
  for (const s of snacks) { snackProtein += s.protein; snackKcal += s.kcal; }
  totalProtein += snackProtein;
  totalKcal += snackKcal;
  
  // 拼标题
  const trainingTag = training ? `[${training}]` : "[增肌]";
  const pushTitle = `${tomorrow.short} ${tomorrow.weekDay} ${trainingTag} 明日食谱`;
  
  // 拼推送内容
  const snackSection = snacks.length > 0
    ? `\n\n⚡ **训练加餐（${snackKcal}kcal · 蛋白${snackProtein}g）**\n${snacks.map(s => `• ${s.name}`).join("\n")}`
    : "";
  
  const trainingSection = training
    ? `\n💪 **明日训练：** ${training}${trainingNote ? ` · ${trainingNote}` : ""}`
    : "";
  
  // 早餐
  const bfIng = formatIngredients(breakfast.ingredients);
  const bfSteps = formatSteps(breakfast.steps);
  const bfSeasoning = breakfast.seasonings.join("、");
  
  // 午餐
  const luIng = formatIngredients(lunch.ingredients);
  const luSteps = formatSteps(lunch.steps);
  const luSeasoning = lunch.seasonings.join("、");
  
  // 晚餐
  const diIng = formatIngredients(dinner.ingredients);
  const diSteps = formatSteps(dinner.steps);
  const diSeasoning = dinner.seasonings.join("、");
  
  const content = [
    `${tomorrow.dateStr} ${tomorrow.weekDay} ${mod.emoji} ${mod.note}${trainingSection}`,
    "",
    `🔥 全天营养：约 ${totalKcal}kcal · 蛋白 ${totalProtein}g · 碳水 ${Math.round(totalKcal * 0.45 / 4 + mod.carbMod)}g · 脂肪 ${Math.round(totalKcal * 0.22 / 9)}g`,
    "",
    `---`,
    "",
    `🌅 **早餐（${breakfast.time}min · ${breakfast.kcal}kcal · 蛋白${breakfast.protein}g）**`,
    `**${breakfast.name}**`,
    `🥬 食材：${bfIng}`,
    `🧂 调料：${bfSeasoning}`,
    `📝 做法：`,
    bfSteps,
    `▶ 看教程「${breakfast.video}」`,
    breakfast.videoUrl,
    "",
    `☀️ **午餐（${lunch.time}min · ${lunch.kcal}kcal · 蛋白${lunch.protein}g）**`,
    `**${lunch.name}**`,
    `🥬 食材：${luIng}`,
    `🧂 调料：${luSeasoning}`,
    `📝 做法：`,
    luSteps,
    `▶ 看教程「${lunch.video}」`,
    lunch.videoUrl,
    "",
    `🌙 **晚餐（${dinner.time}min · ${dinner.kcal}kcal · 蛋白${dinner.protein}g）**`,
    `**${dinner.name}**`,
    `🥬 食材：${diIng}`,
    `🧂 调料：${diSeasoning}`,
    `📝 做法：`,
    diSteps,
    `▶ 看教程「${dinner.video}」`,
    dinner.videoUrl,
    "",
    snackSection,
    "",
    `💡 **增肌小贴士**：${dailyTip}`,
    "",
    `---`,
    `💪 云端自动生成 · 电脑关着也能收到`
  ].join("\n");
  
  // 推送微信
  console.log(`\n--- Push Content Preview ---\nTitle: ${pushTitle}`);
  console.log(content.slice(0, 300) + "...\n");
  
  await pushWeChat(pushTitle, content);
  
  // 也保存到 GitHub Pages 供网页查看
  try {
    const html = buildHtmlPage(tomorrow, breakfast, lunch, dinner, snacks, mod, dailyTip, totalProtein, totalKcal, training, trainingNote);
    fs.writeFileSync("docs/today-mealplan.html", html, "utf-8");
    console.log("✅ HTML page saved");
  } catch (e) {
    console.log("ℹ️ HTML page not saved (docs/ dir may not exist):", e.message);
  }
  
  console.log("✅ Done - meal plan generated for", tomorrow.short);
}

/**
 * 生成 HTML 网页版食谱
 */
function buildHtmlPage(tomorrow, bf, lu, di, snacks, mod, tip, totalProtein, totalKcal, training, trainingNote) {
  const snackHtml = snacks.length > 0
    ? `<div class="snack-card"><span class="snack-title">⚡ 训练后加餐</span><span class="snack-kcal">${snacks.reduce((s, x) => s + x.kcal, 0)}kcal · 蛋白 ${snacks.reduce((s, x) => s + x.protein, 0)}g</span>${snacks.map(s => `<div class="snack-item">• ${s.name}</div>`).join("")}</div>`
    : "";
  
  const trainingHtml = training
    ? `<div class="training-badge">${mod.emoji} 明日训练：${training}${trainingNote ? ` · ${trainingNote}` : ""}</div>`
    : "";
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>💪 增肌食谱 · ${tomorrow.short}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f5f0eb;color:#2c2c2c;max-width:800px;margin:20px auto;padding:0 20px;line-height:1.7}
.header{background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;border-radius:16px;padding:30px 24px;margin-bottom:20px;text-align:center}
.header h1{font-size:28px;margin-bottom:6px}
.kcal-bar{background:#fff;border-radius:12px;padding:20px;margin-bottom:20px;display:flex;justify-content:space-around;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.kcal-item .val{font-size:24px;font-weight:700;color:#e74c3c}
.kcal-item .lbl{font-size:12px;color:#888;margin-top:2px}
.meal-card{background:#fff;border-radius:12px;padding:24px;margin-bottom:16px;box-shadow:0 2px 8px rgba(0,0,0,.06)}
.meal-title{font-size:18px;font-weight:700;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.steps{margin:12px 0;padding:0;list-style:none}
.steps li{margin-bottom:6px;padding-left:20px;position:relative;font-size:14px}
.steps li::before{content:"▸";position:absolute;left:0;color:#e74c3c}
.video-link{display:inline-block;background:#f5f5f5;color:#1a1a2e;text-decoration:none;padding:6px 14px;border-radius:8px;font-size:13px;margin:4px 4px 0 0}
.ingredients{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;margin:12px 0;font-size:14px}
.ingredients .qty{color:#888}
.tip{background:#fff8e1;border-left:4px solid #f39c12;border-radius:8px;padding:14px 18px;margin-top:16px;font-size:14px}
.tip strong{color:#e67e22}
.footer{text-align:center;color:#aaa;font-size:12px;margin-top:24px;padding:16px}
.snack-card{background:#fff8e1;border-radius:12px;padding:20px;margin-bottom:16px}
.snack-title{font-weight:700;font-size:16px}
.snack-kcal{float:right;font-size:13px;color:#e67e22}
.snack-item{font-size:14px;margin-top:8px}
.training-badge{background:#e8f5e9;border-radius:8px;padding:10px 16px;margin-bottom:16px;font-size:14px;text-align:center;color:#2e7d32}
</style></head>
<body>
<div class="header"><h1>💪 明日增肌食谱</h1><div>📅 ${tomorrow.dateStr} · ${tomorrow.weekDay} · ${mod.emoji} ${mod.note}</div></div>
${trainingHtml}
<div class="kcal-bar">
  <div class="kcal-item"><div class="val">~${totalProtein}g</div><div class="lbl">🧱 蛋白质</div></div>
  <div class="kcal-item"><div class="val">~${Math.round(totalKcal * 0.45 / 4 + mod.carbMod)}g</div><div class="lbl">🌾 碳水</div></div>
  <div class="kcal-item"><div class="val">~${Math.round(totalKcal * 0.22 / 9)}g</div><div class="lbl">🥑 脂肪</div></div>
  <div class="kcal-item"><div class="val">~${totalKcal}</div><div class="lbl">🔥 千卡</div></div>
</div>
<div class="meal-card">
  <div class="meal-title"><span>🌅 早餐 · ${bf.time}分钟</span><span>${bf.kcal}kcal · 蛋白${bf.protein}g</span></div>
  <div><strong>${bf.name}</strong></div>
  <div class="ingredients">${bf.ingredients.map(i => `<div>${i.name} <span class="qty">${i.qty}</span></div>`).join("")}</div>
  <div style="color:#666;font-size:13px;margin:8px 0">🧂 ${bf.seasonings.join(" · ")}</div>
  <ol class="steps">${bf.steps.map(s => `<li>${s}</li>`).join("")}</ol>
  <a class="video-link" href="${bf.videoUrl}" target="_blank">▶ ${bf.video}</a>
</div>
<div class="meal-card">
  <div class="meal-title"><span>☀️ 午餐 · ${lu.time}分钟</span><span>${lu.kcal}kcal · 蛋白${lu.protein}g</span></div>
  <div><strong>${lu.name}</strong></div>
  <div class="ingredients">${lu.ingredients.map(i => `<div>${i.name} <span class="qty">${i.qty}</span></div>`).join("")}</div>
  <div style="color:#666;font-size:13px;margin:8px 0">🧂 ${lu.seasonings.join(" · ")}</div>
  <ol class="steps">${lu.steps.map(s => `<li>${s}</li>`).join("")}</ol>
  <a class="video-link" href="${lu.videoUrl}" target="_blank">▶ ${lu.video}</a>
</div>
<div class="meal-card">
  <div class="meal-title"><span>🌙 晚餐 · ${di.time}分钟</span><span>${di.kcal}kcal · 蛋白${di.protein}g</span></div>
  <div><strong>${di.name}</strong></div>
  <div class="ingredients">${di.ingredients.map(i => `<div>${i.name} <span class="qty">${i.qty}</span></div>`).join("")}</div>
  <div style="color:#666;font-size:13px;margin:8px 0">🧂 ${di.seasonings.join(" · ")}</div>
  <ol class="steps">${di.steps.map(s => `<li>${s}</li>`).join("")}</ol>
  <a class="video-link" href="${di.videoUrl}" target="_blank">▶ ${di.video}</a>
</div>
${snackHtml}
<div class="tip"><strong>💡 增肌小贴士</strong><br>✅ ${tip}</div>
<div class="footer">💪 云端自动生成 · 电脑关着也能收到</div>
</body></html>`;
}

main().catch((e) => {
  console.error("Fatal error:", e.message);
  process.exit(1);
});
