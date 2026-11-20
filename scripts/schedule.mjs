// Which ingestion groups the hourly pipeline runs now (UTC). Prints them space-separated.
const now = new Date();
const h = now.getUTCHours();
const dow = now.getUTCDay(); // 0 = Sunday
const out = ["live"];
if (h % 3 === 0) out.push("opinion");
if (h === 6) out.push("daily");
// Twice a day so election-night results and runoffs show up within hours.
if (h === 8 || h === 20) out.push("elections");
if (h === 9 && dow === 1) out.push("thinkers");
if (h === 9 && dow === 2) out.push("context");
if (h === 10 && dow === 0) out.push("monitor-setup");
console.log(out.join(" "));
