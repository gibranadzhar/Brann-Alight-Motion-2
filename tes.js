// tes.js — Fetch NFToken generator dari Omegatech API & simpan respon JSON
// Usage:
//   node tes.js          -> generate 1 token, save respon JSON
//   node tes.js 5        -> generate 5 token
import { writeFile, readFile } from 'node:fs/promises';

const OMEGATECH_URL = 'https://api.omegatech.app/api/tools/Nftoken?action=generate';
const OUT_FILE = 'results-omegatech.json';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

async function generateNftoken(retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(OMEGATECH_URL, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || json.success !== true) throw new Error(`API error: ${JSON.stringify(json).slice(0, 200)}`);
      return json;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`  Gagal (${err.message}), retry ${attempt}/${retries - 1}...`);
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

async function main() {
  const count = Math.max(1, parseInt(process.argv[2], 10) || 1);
  const results = [];

  // Muat hasil lama kalau ada (append, bukan timpa)
  try {
    const old = JSON.parse(await readFile(OUT_FILE, 'utf8'));
    if (Array.isArray(old)) results.push(...old);
  } catch {}

  for (let i = 1; i <= count; i++) {
    if (count > 1) console.log(`[${i}/${count}] Generating...`);
    try {
      const json = await generateNftoken();
      results.push(json);
      const token = json?.data?.token || '';
      const links = json?.data?.links || {};
      console.log(`  Token: ${token.slice(0, 40)}${token.length > 40 ? '...' : ''}`);
      for (const key of ['pc', 'android', 'tv6', 'tv8']) {
        if (links[key]) console.log(`  ${key.padEnd(8)}: ${links[key]}`);
      }
    } catch (err) {
      console.error(`  GAGAL: ${err.message}`);
    }
  }

  await writeFile(OUT_FILE, JSON.stringify(results, null, 2));
  console.log(`\nSaved ${results.length} respon ke ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
