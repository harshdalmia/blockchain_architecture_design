import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const out = (n) => `/home/claude/insurance-chain/screenshots/${n}.png`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: "shell" });

async function terminal(name, title, text) {
  const p = await b.newPage(); await p.setViewport({ width: 1100, height: 700, deviceScaleFactor: 1.5 });
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  await p.setContent(`<body style="margin:0;background:#0f172a"><div style="background:#1e293b;color:#94a3b8;font:12px system-ui;padding:8px 14px">● ● ●  &nbsp; ${title}</div><pre style="margin:0;padding:16px;color:#e2e8f0;font:13px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap">${esc}</pre></body>`);
  const h = await p.evaluate(() => document.body.scrollHeight);
  await p.setViewport({ width: 1100, height: Math.min(h, 1400), deviceScaleFactor: 1.5 });
  await p.screenshot({ path: out(name) }); await p.close();
}
const nodeLog = strip(fs.readFileSync("node.log", "utf8")).split("\n").filter((l) => !l.startsWith("eth_") && l.trim()).slice(0, 14).join("\n");
await terminal("fig1_local_testnet", "Terminal — npx hardhat node  &  npx hardhat run --network localhost scripts/deploy.js",
  "$ npx hardhat node\n" + nodeLog + "\n  …(20 funded test accounts)…\n\n$ npx hardhat run --network localhost scripts/deploy.js\n" + fs.readFileSync("deploy.log", "utf8"));
await terminal("fig9_test_results", "Terminal — npx hardhat test", "$ npx hardhat test\n\n" + strip(fs.readFileSync("evidence_test_output.txt", "utf8")));

const p = await b.newPage(); await p.setViewport({ width: 1366, height: 900, deviceScaleFactor: 1.5 });
p.on("pageerror", (e) => console.log("PAGEERR", e.message));
await p.goto("http://localhost:5173/", { waitUntil: "networkidle0" });
const role = async (name) => { await p.evaluate((n) => [...document.querySelectorAll(".roles button")].find((x) => x.textContent === n).click(), name); await sleep(700); };
const clickText = async (t) => p.evaluate((t) => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === t).click(), t);
const done = async (frag) => { await sleep(500); await p.waitForFunction((f) => document.querySelector(".toast")?.textContent.includes(f), { timeout: 20000 }, frag); await sleep(700); };

const setAmt = async (v) => { await p.focus("#amount"); await p.keyboard.down("Control"); await p.keyboard.press("KeyA"); await p.keyboard.up("Control"); await p.keyboard.press("Backspace"); await p.type("#amount", v); };
// Fig 2: insurer issues policy
await role("Insurer");
await clickText("Issue policy on-chain"); await done("confirmed");
await p.screenshot({ path: out("fig2_policy_creation") });

// Claim 1: eligible
await role("Policyholder");
await sleep(500);
const holderBefore = await p.evaluate(() => document.querySelector(".stat b").textContent);
await setAmt("2");
await (await p.$("#file")).uploadFile("docs/damage_report_A.txt");
await clickText("Upload to IPFS & submit"); await done("confirmed");
await p.screenshot({ path: out("fig3_claim_submission") });
const claims = await p.$(".col:nth-child(2) .card");
await claims.screenshot({ path: out("fig4_ipfs_hash") });

// Claim 2: same document again -> duplicate flag. Claim 3: large amount -> unusual
await setAmt("3");
await (await p.$("#file")).uploadFile("docs/damage_report_A.txt");
await clickText("Upload to IPFS & submit"); await done("confirmed");
await setAmt("9");
await (await p.$("#file")).uploadFile("docs/major_loss_B.txt");
await clickText("Upload to IPFS & submit"); await done("confirmed");

// Fig 5: insurer manual review view
await role("Insurer");
await p.screenshot({ path: out("fig5_fraud_flagged_review") });
// manual review: reject duplicate (claim 2), clear unusual (claim 3)
await p.evaluate(() => document.querySelectorAll("#claim-2 button")[1].click()); await done("confirmed");
await p.evaluate(() => document.querySelectorAll("#claim-3 button")[0].click()); await done("confirmed");

// Fig 6: multi-party approval on claim 1
await p.evaluate(() => document.querySelector("#claim-1 button").click()); await done("confirmed");
await p.screenshot({ path: out("fig6a_insurer_approval") });
await role("Auditor");
await p.evaluate(() => document.querySelector("#claim-1 button").click()); await done("confirmed");
await p.screenshot({ path: out("fig6b_auditor_approval_paid") });

// Fig 7: payout, holder balance
await role("Policyholder");
const holderAfter = await p.evaluate(() => document.querySelector(".stat b").textContent);
console.log("holder balance before:", holderBefore, "after:", holderAfter);
await p.screenshot({ path: out("fig7_payout_balance") });

// Fig 8: audit trail
const audit = await p.$$(".col:nth-child(2) .card");
await audit[1].screenshot({ path: out("fig8_audit_trail") });
await p.screenshot({ path: out("full_page"), fullPage: true });
await b.close();
console.log("done");
