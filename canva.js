#!/usr/bin/env node
/**
 * CANVA REGISTER & SCRAPER - Browser Headless (Playwright / Patchright)
 * 
 * Perintah:
 *   node main.js register       <- Manual (input email pribadi/gmail + kode OTP)
 *   node main.js auto [jumlah]  <- Otomatis (tempmail azbry, auto dapat OTP)
 *   node main.js login          <- Login akun Canva existing
 *   node main.js status         <- Cek validitas session cookie
 *   node main.js logout         <- Hapus session tersimpan
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import net from "node:net";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_FILE = path.join(__dirname, "canva_session.json");
const AKUN_FILE = path.join(__dirname, "akun_canva.txt");
const AZBRY = "https://api.azbry.com/api/tools/tempmail";

function ask(questionText) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(questionText, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

function probeXServer(display) {
  // Cek apakah X server benar-benar hidup (koneksi unix socket, bukan cuma
  // env DISPLAY basi/stale). Return Promise<boolean>.
  const m = String(display || "").match(/:(\d+)(?:\.\d+)?$/);
  if (!m) return Promise.resolve(false);
  const sockPath = `/tmp/.X11-unix/X${m[1]}`;
  return new Promise((resolve) => {
    try {
      const s = net.connect({ path: sockPath }, () => {
        s.destroy();
        resolve(true);
      });
      s.on("error", () => resolve(false));
      s.setTimeout(1500, () => {
        s.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

async function runPython(code) {
  // FIX XVFB AUTO: script launch browser headless=False (butuh X server).
  // Kalau $DISPLAY kosong ATAU display-nya basi (socket mati/stale), otomatis
  // bungkus python dengan xvfb-run (virtual display) — tanpa mengubah flow.
  const hasDisplay = await probeXServer(process.env.DISPLAY);
  const cmd = hasDisplay ? "python" : "xvfb-run";
  const args = hasDisplay ? ["-c", code] : ["-a", "python", "-c", code];

  if (!hasDisplay) {
    console.log("  [i] X server tidak aktif/basi — auto pakai xvfb-run (virtual display)");
  }

  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    encoding: "utf-8",
    env: process.env,
  });

  if (res.error && res.error.code === "ENOENT") {
    console.error("[X] Perintah tidak ditemukan:", cmd, "— install dengan: apt install -y xvfb");
    return false;
  }
  return res.status === 0;
}

async function registerManual() {
  console.log("==========================================================");
  console.log("  CANVA REGISTER - MANUAL (Email Pribadi / Gmail)");
  console.log("==========================================================");

  const pyCode = `
import json, os, time, sys, getpass, re
from patchright.sync_api import sync_playwright

SESSION_FILE = ${JSON.stringify(SESSION_FILE)}
AKUN_FILE = ${JSON.stringify(AKUN_FILE)}

email = input("Email    : ").strip()
if not email or "@" not in email:
    print("[X] Email tidak valid")
    sys.exit(1)

default_name = re.sub(r"[^a-zA-Z ]", " ", email.split("@")[0]).title().strip() or "User"
name_in = input(f"Nama [{default_name}]: ").strip()
name = name_in if name_in else default_name

password = getpass.getpass("Password : ").strip()
if len(password) < 8:
    print("[X] Password minimal 8 karakter")
    sys.exit(1)

def submit_input(loc, text):
    loc.click()
    p = loc.page
    p.wait_for_timeout(200)
    loc.fill("")
    loc.fill(text)
    p.wait_for_timeout(300)
    loc.press("Enter")
    p.wait_for_timeout(1000)
    try:
        btn = p.get_by_role("button", name="Continue").first
        if btn.is_visible(timeout=1000):
            btn.click(timeout=2000)
    except Exception:
        pass
    p.wait_for_timeout(2500)

SCREENS = {
    "nama": "input[autocomplete='name'], input[name='name'], input[placeholder*='Julie']",
    "sandi": "input[type='password']",
    "kode": "input[autocomplete='one-time-code']",
    "email": "input[name='username'], input[type='email'], input[autocomplete='email'], input[autocomplete='username']",
}

def detect_screen(page, timeout=14):
    start = time.time()
    while time.time() - start < timeout:
        for sname, sel in SCREENS.items():
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=400):
                    return sname, loc
            except Exception:
                pass
        time.sleep(0.8)
    return None, None

BLOCK_MARKERS = (
    ("temporary emails", "DOMAIN_BLOK: Canva menolak domain temp-mail — pakai Gmail/email pribadi."),
    ("can't send a verification code", "IP_BLOK: Canva menolak kirim OTP dari IP ini (security reasons)."),
    ("cannot send a verification code", "IP_BLOK: Canva menolak kirim OTP dari IP ini (security reasons)."),
    ("security reasons", "IP_BLOK: Canva menolak kirim OTP dari IP datacenter/VPN ini."),
)

def check_page_block(page):
    """Deteksi pesan blokir Canva di halaman → return pesan debug, atau None."""
    try:
        txt = page.locator("body").inner_text(timeout=3000).lower()
    except Exception:
        return None
    for marker, msg in BLOCK_MARKERS:
        if marker in txt:
            return msg
    return None

PROXY = os.environ.get("CANVA_PROXY", "").strip()
_launch_kw = {"headless": False, "args": ["--disable-blink-features=AutomationControlled", "--window-position=-32000,-32000", "--window-size=1280,800"]}
if PROXY:
    _launch_kw["proxy"] = {"server": PROXY}
    print(f"  [i] Proxy aktif: {PROXY}", flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(**_launch_kw)
    ctx = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 800}, timezone_id="Asia/Jakarta")
    page = ctx.new_page()
    page.goto("https://www.canva.com/signup/", wait_until="domcontentloaded", timeout=60000)
    
    try:
        page.get_by_text("Accept all cookies").first.click(timeout=2500)
        page.wait_for_timeout(800)
    except Exception:
        pass

    try:
        page.get_by_text("Continue with email").first.click(timeout=6000)
        page.wait_for_timeout(2000)
    except Exception:
        pass

    scr, loc = detect_screen(page, timeout=10)
    if scr == "email":
        submit_input(loc, email)
        print("  [ok] Email terisi & disubmit", flush=True)

    for step in range(8):
        scr, loc = detect_screen(page, timeout=14)
        if not scr:
            break
        if scr == "email" and step > 0:
            continue
        print(f"  [>] Layar terdeteksi: {scr}", flush=True)

        if scr == "kode":
            blk = check_page_block(page)
            if blk:
                print(f"  [X] {blk}", flush=True)
                if blk.startswith("IP_BLOK"):
                    print("      Solusi: CANVA_PROXY=http://user:pass@host:port node canva.js register", flush=True)
                print("  [i] OTP tidak akan masuk selama blokir ini aktif.", flush=True)
                break
            code = input("\\n>> Cek inbox email lo! Masukin kode verifikasi: ").strip()
            submit_input(loc, code)
        elif scr == "nama":
            submit_input(loc, name)
            print("  [ok] Nama terisi & disubmit (Canva sedang kirim OTP)", flush=True)
        elif scr == "sandi":
            submit_input(loc, password)
        elif scr == "email":
            submit_input(loc, email)

        page.wait_for_timeout(2000)
        cookies = ctx.cookies()
        canva_cookies = [c for c in cookies if "canva" in c.get("domain", "")]
        if len(canva_cookies) > 5:
            with open(SESSION_FILE, "w", encoding="utf-8") as f:
                json.dump({"cookies": cookies}, f, indent=2)
            with open(AKUN_FILE, "a", encoding="utf-8") as f:
                f.write(f"{email} | {password}\\n")
            print("\\n[OK] BERHASIL! Session tersimpan & akun dicatat di akun_canva.txt", flush=True)
            browser.close()
            sys.exit(0)

    browser.close()
`;
  await runPython(pyCode);
}

async function registerAuto(jumlah = 1) {
  console.log("==========================================================");
  console.log(`  CANVA REGISTER - OTOMATIS (tempmail azbry) x${jumlah}`);
  console.log("==========================================================");

  const pyCode = `
import json, os, time, random, string, re, sys, requests
from patchright.sync_api import sync_playwright

AZBRY = ${JSON.stringify(AZBRY)}
SESSION_FILE = ${JSON.stringify(SESSION_FILE)}
AKUN_FILE = ${JSON.stringify(AKUN_FILE)}
jumlah = ${jumlah}

def new_mailbox():
    r = requests.get(AZBRY, timeout=30).json()
    res = r["result"]
    return res["mailbox"], res["session"]

def poll_code(session, page=None, max_wait=150):
    """Poll inbox azbry sampai OTP masuk. Cek blokir halaman tiap iterasi;
    kalau Canva menolak kirim OTP, raise RuntimeError supaya fail-fast
    (bukan nunggu 150s sia-sia)."""
    start = time.time()
    while time.time() - start < max_wait:
        if page is not None:
            blk = check_page_block(page)
            if blk:
                raise RuntimeError(blk)
        try:
            r = requests.get(AZBRY, params={"session": session}, timeout=10).json()
            for m in (r.get("result") or {}).get("messages") or []:
                blob = json.dumps(m)
                low = blob.lower()
                if "canva" in low:
                    code = None
                    for kw in ("verification", "verify", "code is", "your code", "kode"):
                        idx = low.find(kw)
                        if idx != -1:
                            mm = re.search(r"\\b(\\d{6})\\b", blob[idx:idx + 500])
                            if mm:
                                code = mm.group(1)
                                break
                    if not code:
                        codes = re.findall(r"\\b(\\d{6})\\b", blob)
                        if codes:
                            code = codes[0]
                    if code:
                        return code
        except RuntimeError:
            raise
        except Exception:
            pass
        time.sleep(4)
    return None

def submit_input(loc, text):
    loc.click()
    p = loc.page
    p.wait_for_timeout(200)
    loc.fill("")
    loc.fill(text)
    p.wait_for_timeout(300)
    loc.press("Enter")
    p.wait_for_timeout(1000)
    try:
        btn = p.get_by_role("button", name="Continue").first
        if btn.is_visible(timeout=1000):
            btn.click(timeout=2000)
    except Exception:
        pass
    p.wait_for_timeout(2500)

SCREENS = {
    "nama": "input[autocomplete='name'], input[name='name'], input[placeholder*='Julie']",
    "sandi": "input[type='password']",
    "kode": "input[autocomplete='one-time-code']",
    "email": "input[name='username'], input[type='email'], input[autocomplete='email'], input[autocomplete='username']",
}

def detect_screen(page, timeout=14):
    start = time.time()
    while time.time() - start < timeout:
        for sname, sel in SCREENS.items():
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=400):
                    return sname, loc
            except Exception:
                pass
        time.sleep(0.8)
    return None, None

BLOCK_MARKERS = (
    ("temporary emails", "DOMAIN_BLOK: Canva menolak domain temp-mail — pakai Gmail/email pribadi."),
    ("can't send a verification code", "IP_BLOK: Canva menolak kirim OTP dari IP ini (security reasons)."),
    ("cannot send a verification code", "IP_BLOK: Canva menolak kirim OTP dari IP ini (security reasons)."),
    ("security reasons", "IP_BLOK: Canva menolak kirim OTP dari IP datacenter/VPN ini."),
)

def check_page_block(page):
    """Deteksi pesan blokir Canva di halaman → return pesan debug, atau None."""
    try:
        txt = page.locator("body").inner_text(timeout=3000).lower()
    except Exception:
        return None
    for marker, msg in BLOCK_MARKERS:
        if marker in txt:
            return msg
    return None

PROXY = os.environ.get("CANVA_PROXY", "").strip()
_launch_kw = {"headless": False, "args": ["--disable-blink-features=AutomationControlled", "--window-position=-32000,-32000", "--window-size=1280,800"]}
if PROXY:
    _launch_kw["proxy"] = {"server": PROXY}
    print(f"  [i] Proxy aktif: {PROXY}", flush=True)

sukses = 0
for i in range(jumlah):
    print(f"\\n---------- AKUN {i + 1}/{jumlah} ----------", flush=True)
    dibuat = False
    for coba in range(1, 6):
        try:
            email, mail_sess = new_mailbox()
        except Exception as e:
            print(f"[X] Gagal bikin email temp: {e}", flush=True)
            continue

        password = "Cv" + "".join(random.choices(string.ascii_letters, k=6)) + "".join(random.choices(string.digits, k=4)) + "!"
        name = re.sub(r"[^a-zA-Z ]", " ", email.split("@")[0]).title().strip()
        domain = email.split("@")[1]
        print(f"  [{coba}/5] Email temp: {email}", flush=True)

        with sync_playwright() as p:
            browser = p.chromium.launch(**_launch_kw)
            ctx = browser.new_context(locale="en-US", viewport={"width": 1280, "height": 800}, timezone_id="Asia/Jakarta")
            page = ctx.new_page()
            try:
                page.goto("https://www.canva.com/signup/", wait_until="domcontentloaded", timeout=60000)
                try:
                    page.get_by_text("Accept all cookies").first.click(timeout=2500)
                except Exception:
                    pass

                try:
                    page.get_by_text("Continue with email").first.click(timeout=6000)
                    page.wait_for_timeout(2000)
                except Exception:
                    pass

                scr, loc = detect_screen(page, timeout=10)
                if scr == "email":
                    submit_input(loc, email)
                    print("  [ok] Email terisi & disubmit", flush=True)

                for step in range(8):
                    scr, loc = detect_screen(page, timeout=14)
                    if not scr:
                        break
                    if scr == "email" and step > 0:
                        continue
                    print(f"  [>] Layar terdeteksi: {scr}", flush=True)

                    if scr == "kode":
                        try:
                            code = poll_code(mail_sess, page)
                        except RuntimeError as pb:
                            print(f"  [X] {pb.args[0]}", flush=True)
                            if pb.args[0].startswith("IP_BLOK"):
                                print("      Solusi: CANVA_PROXY=http://user:pass@host:port node canva.js auto 1", flush=True)
                                print("  [i] Ganti domain tidak akan membantu untuk blokir IP.", flush=True)
                            else:
                                print("  [i] Coba lagi dengan mailbox baru...", flush=True)
                            break
                        if not code:
                            print(f"  [!] Kode verifikasi tidak masuk ke {domain}, ganti domain...", flush=True)
                            break
                        print(f"  [ok] Kode otomatis didapat: {code}", flush=True)
                        submit_input(loc, code)
                    elif scr == "nama":
                        submit_input(loc, name)
                        print("  [ok] Nama terisi & disubmit", flush=True)
                    elif scr == "sandi":
                        submit_input(loc, password)
                    elif scr == "email":
                        submit_input(loc, email)

                    page.wait_for_timeout(2000)
                    cookies = ctx.cookies()
                    canva_cookies = [c for c in cookies if "canva" in c.get("domain", "")]
                    if len(canva_cookies) > 5:
                        with open(SESSION_FILE, "w", encoding="utf-8") as f:
                            json.dump({"cookies": cookies}, f, indent=2)
                        with open(AKUN_FILE, "a", encoding="utf-8") as f:
                            f.write(f"{email} | {password}\\n")
                        print("\\n[OK] BERHASIL! Session tersimpan & akun dicatat di akun_canva.txt", flush=True)
                        sukses += 1
                        dibuat = True
                        break

            except Exception as e:
                print(f"[!] Error saat proses pendaftaran: {e}", flush=True)
            finally:
                browser.close()

        if dibuat:
            break

print(f"\\n===== SELESAI: {sukses}/{jumlah} akun sukses =====", flush=True)
`;
  await runPython(pyCode);
}

async function checkStatus() {
  if (!fs.existsSync(SESSION_FILE)) {
    console.log("[X] Belum ada session. Jalankan: node main.js register atau node main.js auto");
    return;
  }
  const pyCode = `
import json, os
from curl_cffi import requests as cf_requests

with open(${JSON.stringify(SESSION_FILE)}, encoding="utf-8") as f:
    cookies = json.load(f).get("cookies", [])

cdict = {c["name"]: c["value"] for c in cookies if "canva" in c.get("domain", "")}
print(f"[*] {len(cdict)} cookie Canva ditemukan...")

s = cf_requests.Session(impersonate="chrome")
for k, v in cdict.items():
    s.cookies.set(k, v, domain=".canva.com")

try:
    r = s.get("https://www.canva.com/settings", timeout=30, allow_redirects=False)
    if r.status_code == 200:
        print("[OK] SESSION MASIH VALID & AKTIF.")
    else:
        print(f"[X] SESSION EXPIRED / INVALID (HTTP {r.status_code}).")
except Exception as e:
    print(f"[X] Gagal cek session: {e}")
`;
  await runPython(pyCode);
}

function logout() {
  if (fs.existsSync(SESSION_FILE)) {
    fs.unlinkSync(SESSION_FILE);
    console.log("[OK] Session dihapus.");
  } else {
    console.log("[i] Tidak ada session yang tersimpan.");
  }
}

async function main() {
  const cmd = (process.argv[2] || "").toLowerCase();
  if (cmd === "register") {
    await registerManual();
  } else if (cmd === "auto") {
    const jumlah = parseInt(process.argv[3], 10) || 1;
    await registerAuto(jumlah);
  } else if (cmd === "status") {
    await checkStatus();
  } else if (cmd === "logout") {
    logout();
  } else {
    console.log(`
CANVA REGISTER & AUTH HEADLESS (main.js)
========================================
Penggunaan:
  node main.js register       <- Register MANUAL (email lo / Gmail)
  node main.js auto [jumlah]  <- Register OTOMATIS (temp mail, auto OTP)
  node main.js status         <- Cek validitas session cookie Canva
  node main.js logout         <- Hapus session tersimpan
`);
  }
}

main();
