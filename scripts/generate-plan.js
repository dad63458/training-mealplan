const https = require("https");
const fs = require("fs");
const recipes = JSON.parse(fs.readFileSync("recipes.json","utf-8"));
const SK = process.env.SEND_KEY;

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split("T")[0];
}

function pickMeals(cycle) {
  return {
    bf: recipes.breakfasts[cycle % 4],
    lu: recipes.lunches[cycle % 4],
    di: recipes.dinners[cycle % 4]
  };
}

// Try to read training plan from cloud JSON store
async function getTrainingPlan() {
  const urls = [
    "https://jsonblob.com/api/jsonBlob/019ef625-3d87-714a-843c-a8cb71086430",
    "https://api.allorigins.win/raw?url=https://jsonblob.com/api/jsonBlob/019ef625-3d87-714a-843c-a8cb71086430"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch(e) {}
  }
  return { plans: {} };
}

function pushWeChat(title, content) {
  return new Promise(r => {
    if (!SK) { console.log("No SEND_KEY"); r(); return; }
    const d = JSON.stringify({title, desp: content});
    const req = https.request("https://sctapi.ftqq.com/"+SK+".send", {
      method: "POST",
      headers: {"Content-Type":"application/json","Content-Length":Buffer.byteLength(d)}
    }, res => { let b=""; res.on("data",c=>b+=c); res.on("end",()=>{r();}); });
    req.write(d);
    req.end();
  });
}

async function main() {
  const date = tomorrow();
  console.log("Generating for:", date);
  
  const plans = await getTrainingPlan();
  const plan = plans.plans?.[date];
  const training = plan?.training || "增肌";
  console.log("Training:", training);
  
  const dayNum = new Date(date).getDate();
  const m = pickMeals(dayNum % 4);
  
  const title = date + " " + training + " 明日食谱";
  let content = date + " 训练:" + training + "\n\n";
  content += "早餐: " + m.bf.n + " (" + m.bf.k + "kcal 蛋白" + m.bf.p + "g)\n";
  content += "食材: " + m.bf.i + "\n\n";
  content += "午餐: " + m.lu.n + " (" + m.lu.k + "kcal 蛋白" + m.lu.p + "g)\n";
  content += "食材: " + m.lu.i + "\n\n";
  content += "晚餐: " + m.di.n + " (" + m.di.k + "kcal 蛋白" + m.di.p + "g)\n";
  content += "食材: " + m.di.i + "\n\n";
  content += "全天蛋白: " + (m.bf.p + m.lu.p + m.di.p) + "g\n";
  
  if (SK) {
    await pushWeChat(title, content);
    console.log("Pushed to WeChat");
  }
  console.log("Done");
}
main().catch(e => { console.error(e); process.exit(1); });
