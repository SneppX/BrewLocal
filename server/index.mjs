#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { canonicalJson } from "./core/canonical-json.mjs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PermissionManager, RiskLevel } from "./core/permissions.mjs";
import { PolicyStore } from "./core/policy-store.mjs";
import { AuditLog } from "./core/audit.mjs";
import { getSystemInfo } from "./core/system-info.mjs";
import { resolveDirectory, resolveTextFile, listDirectory, readTextFile, resolveWritableTarget, writeTextFile, deleteFile } from "./core/filesystem.mjs";

const SERVER_NAME = "brewpilot-local";
const VERSION = "0.3.1";
const policyStore = new PolicyStore();
const permissionManager = new PermissionManager();
const auditLog = new AuditLog();
const permissionReady = policyStore.load().then((policies) => permissionManager.replacePolicies(policies));
let browserProcess = null;
let cdp = null;
let commandId = 0;
let pending = new Map();
let targetId = null;
let targetSessionId = null;
let browserName = null;
let profileDir = null;
let activeResource = "active-tab";

function send(obj) { process.stdout.write(JSON.stringify(obj) + "\n"); }
function reply(id, result) { send({ jsonrpc:"2.0", id, result }); }
function error(id, code, message) { send({ jsonrpc:"2.0", id, error:{code,message} }); }

function browserCandidates() {
  const p = process.platform;
  const home = os.homedir();
  if (p === "win32") {
    const pf = process.env.PROGRAMFILES || "C:\\Program Files";
    const pfx = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || path.join(home,"AppData","Local");
    return [
      ["chrome",path.join(pf,"Google","Chrome","Application","chrome.exe")],
      ["chrome",path.join(pfx,"Google","Chrome","Application","chrome.exe")],
      ["chrome",path.join(local,"Google","Chrome","Application","chrome.exe")],
      ["edge",path.join(pf,"Microsoft","Edge","Application","msedge.exe")],
      ["edge",path.join(pfx,"Microsoft","Edge","Application","msedge.exe")],
      ["edge",path.join(local,"Microsoft","Edge","Application","msedge.exe")],
      ["brave",path.join(pf,"BraveSoftware","Brave-Browser","Application","brave.exe")],
      ["brave",path.join(local,"BraveSoftware","Brave-Browser","Application","brave.exe")],
      ["vivaldi",path.join(local,"Vivaldi","Application","vivaldi.exe")],
      ["opera",path.join(local,"Programs","Opera","opera.exe")],
      ["opera-gx",path.join(local,"Programs","Opera GX","opera.exe")],
      ["arc",path.join(local,"Programs","Arc","Arc.exe")],
      ["yandex",path.join(local,"Yandex","YandexBrowser","Application","browser.exe")]
    ];
  }
  if (p === "darwin") return [
    ["chrome","/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    ["edge","/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
    ["brave","/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
    ["vivaldi","/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"],
    ["opera","/Applications/Opera.app/Contents/MacOS/Opera"],
    ["opera-gx","/Applications/Opera GX.app/Contents/MacOS/Opera GX"],
    ["arc","/Applications/Arc.app/Contents/MacOS/Arc"],
    ["yandex","/Applications/Yandex.app/Contents/MacOS/Yandex"]
  ];
  return [
    ["chrome","/usr/bin/google-chrome"],["chrome","/usr/bin/google-chrome-stable"],
    ["chromium","/usr/bin/chromium"],["chromium","/usr/bin/chromium-browser"],
    ["edge","/usr/bin/microsoft-edge"],["brave","/usr/bin/brave-browser"],
    ["vivaldi","/usr/bin/vivaldi"],["opera","/usr/bin/opera"],
    ["opera-gx","/usr/bin/opera-gx"],["yandex","/usr/bin/yandex-browser"]
  ];
}

async function findBrowser(choice="auto", executablePath="") {
  if (executablePath) {
    try { await fs.access(executablePath); return {name:choice==="auto"?"custom":choice,path:executablePath}; }
    catch { throw new Error("The supplied browser executable does not exist."); }
  }
  const candidates = browserCandidates().filter(([name]) => choice==="auto" || name===choice);
  for (const [name, p] of candidates) {
    try { await fs.access(p); return {name,path:p}; } catch {}
  }
  throw new Error(`No installed ${choice==="auto"?"supported Chromium browser":choice} was found. Install Chrome, Edge, Brave, Vivaldi, or Opera, or provide executablePath.`);
}

async function cdpCall(method, params={}) {
  if (!cdp || cdp.readyState !== WebSocket.OPEN) throw new Error("Browser is not connected. Call browser_launch first.");
  const id = ++commandId;
  return await new Promise((resolve,reject) => {
    const timer = setTimeout(()=>{ pending.delete(id); reject(new Error(`Browser command timed out: ${method}`)); },15000);
    pending.set(id,{resolve,reject,timer});
    const packet={id,method,params};
    if(targetSessionId && (method.startsWith("Page.") || method.startsWith("Runtime."))) packet.sessionId=targetSessionId;
    cdp.send(JSON.stringify(packet));
  });
}

async function connectCDP(wsUrl) {
  cdp = new WebSocket(wsUrl);
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error("Timed out connecting to browser DevTools.")),10000);
    cdp.addEventListener("open",()=>{clearTimeout(timer);resolve();},{once:true});
    cdp.addEventListener("error",()=>{clearTimeout(timer);reject(new Error("Could not connect to browser DevTools."));},{once:true});
  });
  cdp.addEventListener("message", ev=>{
    let msg; try { msg=JSON.parse(ev.data); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const p=pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message || "CDP command failed"));
      else p.resolve(msg.result || {});
    }
  });
  const targets = await cdpCall("Target.getTargets");
  let page=(targets.targetInfos||[]).find(t=>t.type==="page");
  if (!page) {
    const created=await cdpCall("Target.createTarget",{url:"about:blank"});
    targetId=created.targetId;
  } else targetId=page.targetId;
  await cdpCall("Target.activateTarget",{targetId});
  const attached=await cdpCall("Target.attachToTarget",{targetId,flatten:true});
  targetSessionId=attached.sessionId;
  await cdpCall("Page.enable");
  await cdpCall("Runtime.enable");
}

async function ensureTarget() {
  if (!targetId) throw new Error("No active browser tab. Launch the browser first.");
  return targetId;
}
async function evaluate(expression) {
  await ensureTarget();
  const r=await cdpCall("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || "Page evaluation failed.");
  return r.result?.value;
}
async function launchBrowser(args={}) {
  if (cdp && cdp.readyState===WebSocket.OPEN) return {status:"already_running",browser:browserName,profileDir};
  const found=await findBrowser(args.browser||"auto",args.executablePath||"");
  browserName=found.name;
  const base=path.join(os.homedir(),".brewpilot","profiles",browserName);
  profileDir=base;
  await fs.mkdir(base,{recursive:true});
  const activeFile=path.join(base,"DevToolsActivePort");
  await fs.rm(activeFile,{force:true});
  const flags=[
    "--remote-debugging-port=0",
    `--user-data-dir=${base}`,
    "--no-first-run","--no-default-browser-check",
    "--disable-features=Translate",
    args.headless===true?"--headless=new":""
  ].filter(Boolean);
  browserProcess=spawn(found.path,flags,{stdio:"ignore",detached:process.platform!=="win32"});
  browserProcess.on("error",()=>{});
  let portLine="";
  for(let i=0;i<100;i++){
    try { portLine=(await fs.readFile(activeFile,"utf8")).split(/\r?\n/)[0]; if(portLine) break; } catch {}
    await new Promise(r=>setTimeout(r,200));
  }
  if(!portLine) throw new Error("Browser started but did not expose its DevTools endpoint. Check whether remote debugging is allowed by browser policy.");
  const response=await fetch(`http://127.0.0.1:${portLine}/json/version`);
  if(!response.ok) throw new Error("Could not read browser DevTools endpoint.");
  const info=await response.json();
  await connectCDP(info.webSocketDebuggerUrl);
  return {status:"launched",browser:browserName,profileDir,initialUrl:"about:blank",note:"This is an isolated BrewPilot profile. Sign in directly in this browser if needed."};
}

const tools = [
 {name:"permissions_list",description:"List BrewPilot's local permission policies. Unmatched operations are denied by default.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"permissions_set",description:"Create or replace one local permission rule. Modes: deny, ask, session, always. Use exact capability, operation and resource values for narrow rules; wildcards are broad and must be deliberate.",inputSchema:{type:"object",properties:{capability:{type:"string",minLength:1,maxLength:128},operation:{type:"string",minLength:1,maxLength:128},resource:{type:"string",minLength:1,maxLength:512},mode:{type:"string",enum:["deny","ask","session","always"]}},required:["capability","operation","mode"],additionalProperties:false}},
 {name:"permissions_approve_once",description:"Approve one pending action for 60 seconds. Requires the exact requestId and argumentDigest returned by approval_required, plus the exact capability, operation and resource. Call only after explicit user confirmation.",inputSchema:{type:"object",properties:{requestId:{type:"string",format:"uuid"},argumentDigest:{type:"string",pattern:"^[a-f0-9]{64}$"},capability:{type:"string",minLength:1,maxLength:128},operation:{type:"string",minLength:1,maxLength:128},resource:{type:"string",minLength:1,maxLength:512}},required:["requestId","argumentDigest","capability","operation","resource"],additionalProperties:false}},
 {name:"permissions_grant_session",description:"Grant one exact capability, operation and resource for this plugin process session. The matching policy must be in session mode. Call only after explicit user approval.",inputSchema:{type:"object",properties:{capability:{type:"string",minLength:1,maxLength:128},operation:{type:"string",minLength:1,maxLength:128},resource:{type:"string",minLength:1,maxLength:512}},required:["capability","operation","resource"],additionalProperties:false}},
 {name:"permissions_revoke_session",description:"Revoke all temporary permission grants for this plugin process session.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"permissions_reset",description:"Remove all saved permission rules. After reset, every capability is denied by default.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"audit_list",description:"List recent permission decisions from the current plugin process session. Audit metadata is redacted and is not a persistent history in this release.",inputSchema:{type:"object",properties:{limit:{type:"integer",minimum:1,maximum:500}},additionalProperties:false}},
 {name:"system_info",description:"Read basic operating-system and hardware information. Does not return usernames, hostnames, environment variables, files, or process lists. Requires the system/info/system permission.",inputSchema:{type:"object",properties:{},additionalProperties:false}},
 {name:"files_list",description:"List metadata for entries in one exact local directory. No recursive traversal. Requires a matching files/list/path permission; unmatched paths are denied.",inputSchema:{type:"object",properties:{directory:{type:"string",minLength:1,maxLength:4096},maxEntries:{type:"integer",minimum:1,maximum:200}},required:["directory"],additionalProperties:false}},
 {name:"files_read",description:"Read one bounded UTF-8 text file from an exact local path. Binary files and files above the configured limit are rejected. Requires a matching files/read/path permission.",inputSchema:{type:"object",properties:{filePath:{type:"string",minLength:1,maxLength:4096},maxBytes:{type:"integer",minimum:1024,maximum:262144}},required:["filePath"],additionalProperties:false}},
 {name:"files_write",description:"Create or update one bounded UTF-8 text file at an exact local path. New files require files/write/path permission. Replacing an existing file always requires fresh confirmation, even with a persistent policy.",inputSchema:{type:"object",properties:{filePath:{type:"string",minLength:1,maxLength:4096},content:{type:"string",maxLength:262144},overwrite:{type:"boolean"}},required:["filePath","content"],additionalProperties:false}},
 {name:"files_delete",description:"Delete one regular local file at an exact path. Deletion always requires fresh confirmation, even with a persistent policy.",inputSchema:{type:"object",properties:{filePath:{type:"string",minLength:1,maxLength:4096}},required:["filePath"],additionalProperties:false}},
 {name:"browser_launch",description:"Launch an isolated local Chromium-based browser. Requires browser/launch/local-browser permission.",inputSchema:{type:"object",properties:{browser:{type:"string",description:"auto, chrome, edge, brave, vivaldi, opera, chromium, or custom"},executablePath:{type:"string"},headless:{type:"boolean"}},additionalProperties:false}},
 {name:"browser_navigate",description:"Navigate the active tab to an HTTP(S) URL. Permission is scoped to the destination hostname.",inputSchema:{type:"object",properties:{url:{type:"string"}},required:["url"],additionalProperties:false}},
 {name:"browser_inspect",description:"Inspect the current page title, URL, visible text, and interactive elements.",inputSchema:{type:"object",properties:{maxTextChars:{type:"integer",minimum:500,maximum:20000}},additionalProperties:false}},
 {name:"browser_click",description:"Click one visible element using a CSS selector. Requires browser/click permission.",inputSchema:{type:"object",properties:{selector:{type:"string"}},required:["selector"],additionalProperties:false}},
 {name:"browser_type",description:"Type text into a visible input or contenteditable element selected by CSS. Requires browser/type permission.",inputSchema:{type:"object",properties:{selector:{type:"string"},text:{type:"string"},clearFirst:{type:"boolean"}},required:["selector","text"],additionalProperties:false}},
 {name:"browser_fill",description:"Set the value of an input, textarea, or select element using a CSS selector. Requires browser/fill permission.",inputSchema:{type:"object",properties:{selector:{type:"string"},value:{type:"string"}},required:["selector","value"],additionalProperties:false}},
 {name:"browser_scroll",description:"Scroll the active page by a number of pixels.",inputSchema:{type:"object",properties:{pixels:{type:"integer",minimum:-10000,maximum:10000}},required:["pixels"],additionalProperties:false}},
 {name:"browser_screenshot",description:"Capture a screenshot of the current page and return it as an image.",inputSchema:{type:"object",properties:{fullPage:{type:"boolean"}},additionalProperties:false}},
 {name:"browser_extract",description:"Extract page text, links, or tables from the current page.",inputSchema:{type:"object",properties:{kind:{type:"string",enum:["text","links","tables"]},maxItems:{type:"integer",minimum:1,maximum:500}},required:["kind"],additionalProperties:false}},
 {name:"browser_tabs",description:"List tabs or switch to a tab by target ID.",inputSchema:{type:"object",properties:{action:{type:"string",enum:["list","switch"]},targetId:{type:"string"}},required:["action"],additionalProperties:false}},
 {name:"browser_wait",description:"Wait for a CSS selector to appear.",inputSchema:{type:"object",properties:{selector:{type:"string"},timeoutMs:{type:"integer",minimum:100,maximum:30000}},required:["selector"],additionalProperties:false}},
 {name:"browser_stop",description:"Close the BrewPilot browser session. This emergency cleanup action is always available.",inputSchema:{type:"object",properties:{},additionalProperties:false}}
];

async function authorize(request, action, actionArgs = {}) {
  await permissionReady;
  const argumentDigest = createHash("sha256").update(canonicalJson(actionArgs)).digest("hex");
  const decision = permissionManager.evaluate({ ...request, argumentDigest });
  auditLog.record({ action: "permission_check", ...request, decision: decision.decision, metadata: { reason: decision.reason } });
  if (decision.decision !== "allow") {
    const approval = decision.decision === "ask"
      ? permissionManager.createApprovalRequest(request, argumentDigest)
      : null;
    return {
      status: decision.decision === "ask" ? "approval_required" : "permission_denied",
      permission: { capability: request.capability, operation: request.operation, resource: request.resource, risk: request.risk },
      ...(approval ? { approval } : {}),
      reason: decision.reason,
      nextStep: decision.decision === "ask"
        ? "Ask the user for explicit approval. After approval, call permissions_approve_once with the exact requestId, argumentDigest and permission tuple returned here, then retry the identical action arguments within 60 seconds."
        : "The user can explicitly configure a matching rule with permissions_set. No action was executed."
    };
  }
  return action();
}

async function runTool(name,a) {
  await permissionReady;
  if (name === "permissions_list") return { policies: permissionManager.listPolicies(), default: "deny" };
  if (name === "permissions_set") {
    const policy = permissionManager.setPolicy({ capability: a.capability, operation: a.operation, resource: a.resource ?? "*", mode: a.mode });
    await policyStore.save(permissionManager.listPolicies());
    auditLog.record({ action: "policy_updated", capability: policy.capability, operation: policy.operation, resource: policy.resource, decision: "saved", metadata: { mode: policy.mode } });
    return { status: "saved", policy };
  }
  if (name === "permissions_approve_once") {
    const request = { capability: a.capability, operation: a.operation, resource: a.resource };
    permissionManager.grantOnce(request, { requestId: a.requestId, argumentDigest: a.argumentDigest });
    auditLog.record({ action: "one_time_approval_granted", ...request, decision: "approved" });
    return { status: "approved_once", request, note: "The next matching operation can run once. The approval is not persistent." };
  }
  if (name === "permissions_grant_session") {
    const request = { capability: a.capability, operation: a.operation, resource: a.resource };
    permissionManager.grantForSession(request);
    auditLog.record({ action: "session_grant_created", ...request, decision: "approved" });
    return { status: "granted_for_session", request };
  }
  if (name === "permissions_revoke_session") {
    permissionManager.revokeSessionGrants();
    auditLog.record({ action: "session_grants_revoked", capability: "*", operation: "*", resource: "*", decision: "revoked" });
    return { status: "session_grants_revoked" };
  }
  if (name === "permissions_reset") {
    permissionManager.replacePolicies([]);
    await policyStore.save([]);
    auditLog.record({ action: "permission_policies_reset", capability: "*", operation: "*", resource: "*", decision: "reset" });
    return { status: "reset", default: "deny", policies: [] };
  }
  if (name === "audit_list") return { events: auditLog.list(a.limit ?? 100), persistence: "current process session only" };
  if (name === "system_info") {
    return authorize({ capability: "system", operation: "info", resource: "system", risk: RiskLevel.READ }, async () => getSystemInfo(), a);
  }
  if (name === "files_list") {
    const directory = await resolveDirectory(a.directory);
    return authorize({ capability: "files", operation: "list", resource: directory, risk: RiskLevel.READ }, async () => listDirectory(directory, { maxEntries: a.maxEntries }), a);
  }
  if (name === "files_read") {
    const filePath = await resolveTextFile(a.filePath, { maxBytes: a.maxBytes });
    return authorize({ capability: "files", operation: "read", resource: filePath, risk: RiskLevel.READ }, async () => readTextFile(filePath, { maxBytes: a.maxBytes }), a);
  }
  if (name === "files_write") {
    const target = await resolveWritableTarget(a.filePath);
    if (target.exists && a.overwrite !== true) throw new Error("The target file already exists. Set overwrite=true only after explicit approval.");
    const risk = target.exists ? RiskLevel.DESTRUCTIVE : RiskLevel.WRITE;
    return authorize({ capability: "files", operation: "write", resource: target.path, risk }, async () => writeTextFile(target.path, a.content, { overwrite: a.overwrite === true }), a);
  }
  if (name === "files_delete") {
    const target = await resolveWritableTarget(a.filePath);
    if (!target.exists) throw new Error("The requested file does not exist.");
    return authorize({ capability: "files", operation: "delete", resource: target.path, risk: RiskLevel.DESTRUCTIVE }, async () => deleteFile(target.path), a);
  }
  if (name === "browser_stop") {
    if(cdp){try{cdp.close()}catch{} cdp=null;}
    if(browserProcess && !browserProcess.killed) browserProcess.kill();
    browserProcess=null; targetId=null; targetSessionId=null; activeResource="active-tab";
    auditLog.record({ action: "browser_stop", capability: "browser", operation: "stop", resource: "local-browser", decision: "allowed" });
    return {status:"stopped"};
  }
  if (name === "browser_launch") {
    return authorize({ capability: "browser", operation: "launch", resource: "local-browser", risk: RiskLevel.WRITE }, () => launchBrowser(a), a);
  }
  if (name === "browser_navigate") {
    let url;
    try { url = new URL(a.url); } catch { throw new Error("A valid HTTP(S) URL is required."); }
    if (!["http:","https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are allowed.");
    return authorize({ capability: "browser", operation: "navigate", resource: url.hostname.toLowerCase(), risk: RiskLevel.EXTERNAL }, async () => {
      if(!cdp || cdp.readyState!==WebSocket.OPEN) throw new Error("No browser session. Call browser_launch first.");
      await cdpCall("Page.navigate",{url:url.href});
      await new Promise(r=>setTimeout(r,700));
      activeResource = url.hostname.toLowerCase();
      return {url:await evaluate("location.href"),title:await evaluate("document.title")};
    }, a);
  }
  const browserOperations = {
    browser_inspect: ["inspect", RiskLevel.READ],
    browser_click: ["click", RiskLevel.WRITE],
    browser_type: ["type", RiskLevel.WRITE],
    browser_fill: ["fill", RiskLevel.WRITE],
    browser_scroll: ["scroll", RiskLevel.WRITE],
    browser_screenshot: ["screenshot", RiskLevel.READ],
    browser_extract: ["extract", RiskLevel.READ],
    browser_tabs: ["tabs", RiskLevel.READ],
    browser_wait: ["wait", RiskLevel.READ],
  };
  const operation = browserOperations[name];
  if (!operation) throw new Error("Unknown tool: " + name);
  return authorize({ capability: "browser", operation: operation[0], resource: activeResource, risk: operation[1] }, async () => {
    if(!cdp || cdp.readyState!==WebSocket.OPEN) throw new Error("No browser session. Call browser_launch first.");
    if(name==="browser_inspect"){
      return await evaluate(`(()=>({url:location.href,title:document.title,text:(document.body?.innerText||"").slice(0,${Math.max(500,Math.min(20000,a.maxTextChars||8000))}),elements:[...document.querySelectorAll('a,button,input,textarea,select,[role=button]')].slice(0,150).map((e,i)=>({index:i,tag:e.tagName,role:e.getAttribute('role'),text:(e.innerText||e.getAttribute('aria-label')||e.placeholder||e.value||'').trim().slice(0,180),type:e.type||null,selector:e.id?'#'+CSS.escape(e.id):e.getAttribute('name')?e.tagName.toLowerCase()+'[name="'+CSS.escape(e.getAttribute('name'))+'"]':null,disabled:!!e.disabled}))}))()`);
    }
    if(name==="browser_click"){
      const sel=JSON.stringify(a.selector);
      return await evaluate(`(()=>{const e=document.querySelector(${sel});if(!e)throw Error('Selector not found');if(e.disabled)throw Error('Element is disabled');if(!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')throw Error('Element is not visible');e.scrollIntoView({block:'center'});e.click();return {clicked:true,tag:e.tagName,text:(e.innerText||'').slice(0,160)}})()`);
    }
    if(name==="browser_type" || name==="browser_fill"){
      const sel=JSON.stringify(a.selector), val=JSON.stringify(a.text??a.value);
      return await evaluate(`(()=>{const e=document.querySelector(${sel});if(!e)throw Error('Selector not found');if(!e.getClientRects().length||getComputedStyle(e).visibility==='hidden')throw Error('Element is not visible');e.focus();const next=${name==="browser_type"?`(${a.clearFirst?"''":"e.value"}+${val})`:val};if(e.tagName==='SELECT'){const option=[...e.options].find(o=>o.value===next||o.text===next);if(!option)throw Error('No matching select option');e.value=option.value;}else if('value' in e){const proto=Object.getPrototypeOf(e);const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;if(setter)setter.call(e,next);else e.value=next;}else e.textContent=next;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {updated:true,tag:e.tagName}})()`);
    }
    if(name==="browser_scroll") return await evaluate(`(()=>{window.scrollBy(0,${a.pixels});return {scrollY:window.scrollY}})()`);
    if(name==="browser_screenshot"){
      const r=await cdpCall("Page.captureScreenshot",{format:"png",captureBeyondViewport:!!a.fullPage,fromSurface:true});
      return {content:[{type:"image",data:r.data,mimeType:"image/png"}]};
    }
    if(name==="browser_extract"){
      const k=a.kind, n=Math.min(500,a.maxItems||100);
      const expr=k==="links"?`[...document.querySelectorAll('a[href]')].slice(0,${n}).map(a=>({text:a.innerText.trim(),href:a.href}))`:
        k==="tables"?`[...document.querySelectorAll('table')].slice(0,${n}).map(t=>[...t.rows].map(r=>[...r.cells].map(c=>c.innerText.trim())))`:
        `document.body?.innerText||''`;
      return await evaluate(expr);
    }
    if(name==="browser_tabs"){
      const ts=await cdpCall("Target.getTargets"), pages=(ts.targetInfos||[]).filter(t=>t.type==="page");
      if(a.action==="list") return pages.map(t=>({targetId:t.targetId,url:t.url,title:t.title,active:t.targetId===targetId}));
      const selectedPage = pages.find(t => t.targetId === a.targetId);
      if(!selectedPage) throw new Error("Unknown page targetId.");
      targetId=a.targetId; await cdpCall("Target.activateTarget",{targetId}); const attached=await cdpCall("Target.attachToTarget",{targetId,flatten:true}); targetSessionId=attached.sessionId; await cdpCall("Page.enable"); await cdpCall("Runtime.enable");
      try { activeResource = new URL(selectedPage.url).hostname.toLowerCase() || "active-tab"; } catch { activeResource = "active-tab"; }
      return {activeTargetId:targetId,resource:activeResource};
    }
    if(name==="browser_wait"){
      const start=Date.now(), timeout=Math.min(30000,a.timeoutMs||10000);
      while(Date.now()-start<timeout){
        const ok=await evaluate(`!!document.querySelector(${JSON.stringify(a.selector)})`);
        if(ok) return {found:true,selector:a.selector};
        await new Promise(r=>setTimeout(r,250));
      }
      throw new Error("Timed out waiting for selector.");
    }
    throw new Error("Unknown tool: "+name);
  }, a);
}

process.stdin.setEncoding("utf8");
let buffer="";
process.stdin.on("data",chunk=>{
  buffer+=chunk;
  while(true){
    const i=buffer.indexOf("\n"); if(i<0) break;
    const line=buffer.slice(0,i).trim(); buffer=buffer.slice(i+1);
    if(!line) continue;
    let msg; try{msg=JSON.parse(line)}catch{continue;}
    if(msg.method==="notifications/initialized") continue;
    if(msg.method==="initialize"){
      reply(msg.id,{protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:SERVER_NAME,version:VERSION}});
    } else if(msg.method==="ping") reply(msg.id,{});
    else if(msg.method==="tools/list") reply(msg.id,{tools});
    else if(msg.method==="tools/call"){
      const name=msg.params?.name, args=msg.params?.arguments||{};
      runTool(name,args).then(result=>{
        if(result?.content) reply(msg.id,{content:result.content});
        else reply(msg.id,{content:[{type:"text",text:JSON.stringify(result)}]});
      }).catch(e=>reply(msg.id,{content:[{type:"text",text:e.message}],isError:true}));
    } else if(msg.id!==undefined) error(msg.id,-32601,"Method not found");
  }
});
process.stdin.on("end",()=>{try{cdp?.close()}catch{}; if(browserProcess&&!browserProcess.killed)browserProcess.kill();});
