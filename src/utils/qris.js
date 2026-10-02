/**
 * QRIS Static Payment — generator QRIS tanpa library eksternal.
 * Implementasi TLV (Tag-Length-Value) + CRC16-CCITT sesuai standar QRIS
 * (QR Code Payment Specification, EMVCo) dan spek update.md.
 * Render gambar PNG memakai paket `qrcode` (pure JS, tanpa native dep).
 */
import fs from 'fs';
import path from 'path';
import https from 'https';
import QRCode from 'qrcode';
import { DATA_DIR } from './store.js';

export const QRIS_IMAGE_DIR = path.join(DATA_DIR, 'qris');

export const MERCHANT_HISTORY_URL = 'https://brann-merchant-production.up.railway.app/api/history/auto';
export const REQUEST_TIMEOUT = 12000;
export const RETRIES = 3;
export const PAYMENT_WINDOW_MS = 20 * 60 * 1000;

export const QRIS_STATIS_BASE =
    process.env.QRIS_STATIS_BASE ||
    '00020101021126610014COM.GO-JEK.WWW01189360091436340650600210G6340650600303UMI' +
    '51440014ID.CO.QRIS.WWW0215ID10265592245750303UMI' +
    '5204899953033605802ID5925Brann STORE, Digital & Kr6007TANGSEL61051531062070703A0163042FC7';

const QRIS_STATIC = QRIS_STATIS_BASE;

export function convertCRC16(str) {
  let crc = 0xFFFF;
  for (let c = 0; c < str.length; c++) {
    crc ^= str.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

export function generateQrisNominal(qrisStatis, nominal) {
  let qrisInput = qrisStatis;
  let amountInput = nominal;
  if (amountInput === undefined) {
    amountInput = qrisInput;
    qrisInput = '';
  }
  if (!qrisInput) qrisInput = QRIS_STATIS_BASE;
  let baseQris = String(qrisInput).trim();
  if (baseQris.length > 8) baseQris = baseQris.slice(0, -8);
  baseQris = baseQris.replace('010211', '010212');
  const amountStr = String(Number(amountInput));
  const tag54 = `54${amountStr.length.toString().padStart(2, '0')}${amountStr}`;
  let stringToCrc;
  if (baseQris.includes('5802ID')) {
    const parts = baseQris.split('5802ID');
    stringToCrc = parts[0] + tag54 + '5802ID' + parts.slice(1).join('5802ID') + '6304';
  } else {
    stringToCrc = baseQris + tag54 + '6304';
  }
  return stringToCrc + convertCRC16(stringToCrc);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'BRANN-DigitalHub/2.0', Accept: 'application/json' },
      timeout: REQUEST_TIMEOUT
    }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Merchant API HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
        }
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Response Merchant API bukan JSON valid')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Merchant API timeout')));
    req.on('error', reject);
  });
}

function num(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[^0-9.-]/g, '');
  return s ? Number(s) : NaN;
}

function amountCandidates(tx) {
  return [
    tx?.amount,
    tx?.nominal,
    tx?.gross_amount,
    tx?.transaction_amount,
    tx?.metadata?.provider_metadata?.aspi?.data?.amount,
    tx?.metadata?.transaction?.amount,
    tx?.data?.amount
  ].map(num).filter(Number.isFinite);
}

function txTimestamp(tx) {
  const values = [
    tx?.time,
    tx?.transaction_time,
    tx?.created_at,
    tx?.metadata?.transaction?.transaction_time,
    tx?.metadata?.transaction?.created_at
  ];
  for (const v of values) {
    const t = Date.parse(v);
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

function isQris(tx) {
  const values = [
    tx?.payment_type,
    tx?.metadata?.transaction?.payment_type,
    tx?.metadata?.transaction?.payment_method,
    tx?.type
  ].map(v => String(v || '').toLowerCase());
  return values.some(v => v === 'qris' || v.includes('qris'));
}

function isSuccess(tx) {
  const values = [tx?.status, tx?.metadata?.transaction?.status, tx?.transaction_status]
    .map(v => String(v || '').toUpperCase().trim());
  return values.some(v => ['SUCCESS','SETTLEMENT','SUCCESSFUL','COMPLETED','CAPTURE','BERHASIL','PAID'].includes(v));
}

function transactionKey(tx) {
  return String(tx?.id || tx?.reference_id || tx?.transaction_id || '').trim();
}

const consumedTransactions = new Set();

export async function verifyGopayPayment(targetAmount, createdAt = Date.now()) {
  const expected = Number(targetAmount);
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(expected) || expected <= 0 || !Number.isFinite(created)) return false;
  if (Date.now() - created > PAYMENT_WINDOW_MS) return false;
  const start = new Date(Math.max(created - 5000, Date.now() - 24 * 60 * 60 * 1000)).toISOString();
  const url = `${MERCHANT_HISTORY_URL}?start_time=${encodeURIComponent(start)}`;
  let lastError = null;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const json = await requestJson(url);
      if (!json?.success || !Array.isArray(json.data)) throw new Error('Merchant API mengembalikan history tidak valid');

      const matches = json.data.filter(tx => {
        const amounts = amountCandidates(tx);
        const amountMatch = amounts.some(a => a === expected || a === expected * 100);
        const txTime = txTimestamp(tx);
        const timeMatch = Number.isFinite(txTime) && txTime >= created;
        const qrisMatch = isQris(tx) || tx?.merchant_id || tx?.reference_id;
        const statusMatch = isSuccess(tx);
        const key = transactionKey(tx);
        const unused = !key || !consumedTransactions.has(key);
        return amountMatch && timeMatch && qrisMatch && statusMatch && unused;
      }).sort((a,b) => txTimestamp(b) - txTimestamp(a));

      if (matches.length) {
        const key = transactionKey(matches[0]);
        if (key) consumedTransactions.add(key);
        return true;
      }

      if (attempt < RETRIES) await new Promise(r => setTimeout(r, 1500 * attempt));
    } catch (err) {
      lastError = err;
      if (attempt < RETRIES) await new Promise(r => setTimeout(r, 1200 * attempt));
    }
  }

  if (lastError) throw lastError;
  return false;
}

/**
 * Parsing string QRIS menjadi daftar entri TLV.
 * Format QRIS (EMVCo): tag 2 karakter + panjang 2 digit + nilai.
 * (Tag 26 berisi sub-TLV dengan struktur yang sama.)
 */
export function parseTLV(payload) {
    const entries = [];
    let offset = 0;
    while (offset + 4 <= payload.length) {
        const tag = payload.slice(offset, offset + 2);
        offset += 2;
        if (offset + 2 > payload.length) break;
        const length = parseInt(payload.slice(offset, offset + 2), 10);
        offset += 2;
        if (isNaN(length) || offset + length > payload.length) break;
        const value = payload.slice(offset, offset + length);
        offset += length;
        entries.push({ tag, value });
    }
    return entries;
}

/**
 * Menyusun satu entri TLV: tag (2 karakter) + panjang (2 digit) + nilai.
 */
export function buildTLV(tag, value) {
    const length = String(String(value).length).padStart(2, '0');
    return String(tag) + length + String(value);
}

/**
 * CRC16-CCITT (polynomial 0x1021, initial 0xFFFF, tanpa reflection).
 * Dihitung terhadap seluruh payload QRIS termasuk placeholder "6304".
 */
export function crc16ccitt(data) {
    let crc = 0xffff;
    for (let i = 0; i < data.length; i++) {
        crc ^= (data.charCodeAt(i) << 8) & 0xffff;
        for (let j = 0; j < 8; j++) {
            if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
            else crc = (crc << 1) & 0xffff;
        }
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Menempelkan tag 63 + CRC16 ke payload QRIS.
 */
export function withCRC(payload) {
    const base = payload.replace(/6304[0-9A-Fa-f]{4}$/, '6304');
    return base + crc16ccitt(base);
}

/**
 * Validasi amount: harus string angka bulat positif, aman untuk integer.
 * Mengembalikan string nominal (bukan parse awal yang longgar).
 */
export function normalizeAmount(amount) {
    const value = String(amount == null ? '' : amount).trim();
    if (!/^\d+$/.test(value)) {
        throw new Error('Amount harus berupa angka bulat');
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error('Amount harus berupa angka bulat positif');
    }
    return String(number);
}

/**
 * Mengganti nominal (tag 54) pada QRIS string, menghitung ulang CRC.
 * Tag 54 disisipkan tepat setelah tag 53 (currency) bila belum ada,
 * sesuai urutan standar QRIS.
 */
export function setAmount(qrString, amount) {
    const normalized = normalizeAmount(amount);
    const entries = parseTLV(String(qrString).trim());
    const result = [];
    let inserted = false;
    for (const entry of entries) {
        if (entry.tag === '54') {
            result.push(buildTLV('54', normalized));
            inserted = true;
            continue;
        }
        result.push(buildTLV(entry.tag, entry.value));
        if (!inserted && entry.tag === '53') {
            result.push(buildTLV('54', normalized));
            inserted = true;
        }
    }
    if (!inserted) {
        throw new Error('QRIS payload tidak valid: tag 53 (currency) tidak ditemukan');
    }
    return withCRC(result.join(''));
}

function ensureImageDir() {
    if (!fs.existsSync(QRIS_IMAGE_DIR)) fs.mkdirSync(QRIS_IMAGE_DIR, { recursive: true });
}

/**
 * Membersihkan file PNG QRIS yang berumur lebih dari 24 jam agar
 * folder data/qris tidak menumpuk.
 */
function cleanupOldImages() {
    try {
        ensureImageDir();
        const cutoff = Date.now() - 24 * 3600 * 1000;
        for (const name of fs.readdirSync(QRIS_IMAGE_DIR)) {
            // Jangan hapus QRIS statis merchant (dipakai card #purchase).
            if (name === 'qris-static.png') continue;
            const file = path.join(QRIS_IMAGE_DIR, name);
            const stat = fs.statSync(file);
            if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(file);
        }
    } catch (e) {
        // Cleanup gagal tidak menghentikan pembayaran.
    }
}

/**
 * Membuat QRIS statis merchant (tanpa nominal/amount — tag 01 static)
 * untuk ditampilkan di card pembayaran bawah #purchase.
 * File ditulis sekali ke data/qris/qris-static.png bila belum ada.
 */
export async function ensureStaticQRIS() {
    try {
        ensureImageDir();
        const filePath = path.join(QRIS_IMAGE_DIR, 'qris-static.png');
        if (fs.existsSync(filePath)) return '/files/qris-static.png';
        // withoutCRC ulang dari payload dasar (tanpa tag 54 amount).
        const qrString = withCRC(QRIS_STATIC.replace(/6304[0-9A-Fa-f]{4}$/, '6304'));
        await QRCode.toFile(filePath, qrString, {
            errorCorrectionLevel: 'M',
            margin: 2,
            width: 640,
        });
        return '/files/qris-static.png';
    } catch (e) {
        return '/files/qris-static.png';
    }
}

/**
 * Membuat QRIS statis untuk nominal tertentu:
 * - QRIS string dengan tag 54 + CRC terhitung ulang
 * - PNG di-render ke data/qris/<ts>.png
 * - URL relatif /files/<nama> (disajikan route /files/* di app)
 */
export async function generatePaymentQRIS(amount) {
    const normalized = normalizeAmount(amount);
    const qrString = setAmount(QRIS_STATIC, normalized);
    cleanupOldImages();
    ensureImageDir();
    const filename = 'qris-' + Date.now() + '.png';
    const filePath = path.join(QRIS_IMAGE_DIR, filename);
    await QRCode.toFile(filePath, qrString, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 640,
    });
    return {
        qrString: qrString,
        imageUrl: '/files/' + filename,
        amount: normalized,
    };
}
