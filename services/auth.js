import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * BRANN Firebase Authentication Service
 *
 * Firebase project:
 *   bill-am
 *
 * Authentication:
 *   Firebase Email Link / Passwordless Sign-in
 *
 * Node.js >= 18
 *
 * Railway Environment Variables:
 *   FIREBASE_API_KEY
 *   FIREBASE_CONTINUE_URL
 */

class AlightMotionService {
  constructor(orderId, prefix, getNextCounter) {
    // ==========================================
    // ORDER ID
    // ==========================================

    if (prefix && getNextCounter) {
      this._prefix = prefix;
      this._getNextCounter = getNextCounter;
      this.ORDER_ID = null;
    } else {
      this.ORDER_ID =
        String(orderId || "").trim() ||
        this.defaultOrderId();

      this._prefix = null;
      this._getNextCounter = null;
    }

    // ==========================================
    // FIREBASE BILL-AM
    // ==========================================

    this.API_KEY = process.env.FIREBASE_API_KEY;

    this.CONTINUE_URL = String(
      process.env.FIREBASE_CONTINUE_URL ||
      ""
    ).trim();

    if (!this.API_KEY) {
      throw new Error("FIREBASE_API_KEY belum diset di Railway Variables.");
    }

    if (!this.CONTINUE_URL) {
      throw new Error("FIREBASE_CONTINUE_URL belum diset di Railway Variables.");
    }

    let continueUrlObj;
    try {
      continueUrlObj = new URL(this.CONTINUE_URL);
      if (continueUrlObj.protocol !== "https:") {
        throw new Error("FIREBASE_CONTINUE_URL harus memakai HTTPS.");
      }
    } catch (e) {
      throw new Error("FIREBASE_CONTINUE_URL tidak valid: " + e.message);
    }
  }

  // ==========================================
  // DEFAULT ORDER ID
  // ==========================================

  defaultOrderId() {
    const digit = (length) =>
      Math.floor(Math.random() * 9 + 1) +
      Array.from(
        { length: length - 1 },
        () => Math.floor(Math.random() * 10)
      ).join("");

    return `GPA.${digit(4)}.${digit(4)}.${digit(4)}.${digit(5)}`;
  }

  // ==========================================
  // ENSURE ORDER ID
  // ==========================================

  async _ensureOrderId() {
    if (this.ORDER_ID) {
      return this.ORDER_ID;
    }

    if (!this._prefix || !this._getNextCounter) {
      this.ORDER_ID = this.defaultOrderId();
      return this.ORDER_ID;
    }

    const nextNum =
      await this._getNextCounter(this._prefix);

    this.ORDER_ID =
      `${this._prefix}-${String(nextNum).padStart(4, "0")}`;

    return this.ORDER_ID;
  }

  // ==========================================
  // HTTP POST
  // ==========================================

  async _post(
    url,
    body,
    headers = {
      "Content-Type": "application/json",
    },
    timeoutMs = 30000
  ) {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    let data = null;

    try {
      data = await res.json();
    } catch {
      // Response bukan JSON
    }

    if (!res.ok) {
      throw {
        response: {
          status: res.status,
          data: data ?? `HTTP ${res.status}`,
        },
      };
    }

    return { data };
  }

  // ==========================================
  // ERROR FORMATTER
  // ==========================================

  _errText(error) {
    if (
      error &&
      error.response &&
      error.response.data !== undefined
    ) {
      const data = error.response.data;
      if (data && typeof data === "object") {
        const msg = data?.error?.message || data?.message;
        if (msg) return String(msg);
        return JSON.stringify(data);
      }
      return String(data);
    }

    return error?.message || "Unknown error";
  }

  // ==========================================
  // CODE ORDER
  // ==========================================

  generateCodeOrder() {
    return Math.floor(
      10000 + Math.random() * 90000
    ).toString();
  }

  // ==========================================
  // EXTRACT OOB CODE
  // ==========================================

  extractOobCode(fullUrl) {
    if (!fullUrl) return null;

    try {
      let cleanUrl = String(fullUrl)
        .replace(/&amp;/g, "&");

      try {
        cleanUrl = decodeURIComponent(cleanUrl);
      } catch {
        // Abaikan decode error
      }

      // ========================================
      // NORMAL URL
      // ========================================

      try {
        const urlObj = new URL(cleanUrl);

        let oobCode =
          urlObj.searchParams.get("oobCode");

        // ======================================
        // NESTED LINK
        // ======================================

        if (!oobCode) {
          const nestedLink =
            urlObj.searchParams.get("link") ||
            urlObj.searchParams.get("q") ||
            urlObj.searchParams.get("url");

          if (nestedLink) {
            try {
              const innerUrlObj =
                new URL(nestedLink);

              oobCode =
                innerUrlObj.searchParams.get(
                  "oobCode"
                );
            } catch {
              // Abaikan
            }
          }
        }

        if (oobCode) {
          return oobCode.replace(
            /[^a-zA-Z0-9_-]/g,
            ""
          );
        }
      } catch {
        // Lanjut ke regex
      }

      // ========================================
      // REGEX FALLBACK
      // ========================================

      const match =
        cleanUrl.match(
          /[?&]oobCode=([^&]+)/i
        ) ||
        cleanUrl.match(
          /oobCode=([^&]+)/i
        );

      if (match?.[1]) {
        return match[1].replace(
          /[^a-zA-Z0-9_-]/g,
          ""
        );
      }

      return null;
    } catch {
      return null;
    }
  }

  // ==========================================
  // SEND FIREBASE MAGIC LINK
  // ==========================================

  async sendMagicLink(email) {
    try {
      if (!email) {
        throw new Error(
          "Email wajib diisi."
        );
      }

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      if (
        !normalizedEmail.includes("@") ||
        !normalizedEmail.includes(".")
      ) {
        throw new Error(
          "Format email tidak valid."
        );
      }

      const response =
        await this._post(
          `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${this.API_KEY}`,
          {
            requestType: "EMAIL_SIGNIN",
            email: normalizedEmail,
            continueUrl: this.CONTINUE_URL,
            // BRANN menerima/memproses link secara server-side/manual.
            // Jangan paksa Android/iOS deep-link Alight Motion di sini.
            canHandleCodeInApp: false,
          },
          {
            "Content-Type":
              "application/json",
          },
          30000
        );

      return {
        success: true,
        message:
          "Link verifikasi berhasil dikirim.",
        data: response.data,
      };
    } catch (error) {
      return {
        success: false,
        error: this._errText(error),
      };
    }
  }

  // ==========================================
  // VERIFY FIREBASE EMAIL LINK
  // ==========================================

  async verifyAndFetchProfile(
    email,
    rawLink
  ) {
    try {
      if (!email) {
        throw new Error(
          "Email wajib diisi."
        );
      }

      if (!rawLink) {
        throw new Error(
          "Link verifikasi tidak ditemukan."
        );
      }

      const normalizedEmail =
        String(email)
          .trim()
          .toLowerCase();

      // ========================================
      // EXTRACT OOB CODE
      // ========================================

      const oobCode =
        this.extractOobCode(rawLink);

      if (!oobCode) {
        throw new Error(
          "Gagal mengekstrak kode verifikasi."
        );
      }

      // ========================================
      // SIGN IN
      // ========================================

      const signinRes =
        await this._post(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=${this.API_KEY}`,
          {
            email: normalizedEmail,
            oobCode,
          },
          {
            "Content-Type":
              "application/json",
          },
          30000
        );

      const idToken =
        signinRes.data?.idToken;

      if (!idToken) {
        throw new Error(
          "Firebase tidak mengembalikan ID token."
        );
      }

      // ========================================
      // ACCOUNT INFO
      // ========================================

      const accountRes =
        await this._post(
          `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${this.API_KEY}`,
          {
            idToken,
          },
          {
            "Content-Type":
              "application/json",
          },
          30000
        );

      const user =
        accountRes.data?.users?.[0] ||
        null;

      return {
        success: true,
        idToken,
        refreshToken:
          signinRes.data?.refreshToken ||
          null,
        expiresIn:
          signinRes.data?.expiresIn ||
          null,
        user,
      };
    } catch (error) {
      return {
        success: false,
        error: this._errText(error),
      };
    }
  }

  // ==========================================
  // PREMIUM
  // ==========================================
  //
  // Aktivasi entitlement BRANN sendiri.
  // Tidak memanggil atau memodifikasi sistem lisensi pihak ketiga.
  // ==========================================

  async applyPremium(idToken) {
    try {
      if (!idToken) {
        throw new Error("ID token Firebase tidak tersedia.");
      }

      const accountRes = await this._post(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${this.API_KEY}`,
        { idToken },
        { "Content-Type": "application/json" },
        30000
      );

      const user = accountRes.data?.users?.[0];
      if (!user?.localId || !user?.email) {
        throw new Error("Akun Firebase tidak ditemukan.");
      }

      if (user.emailVerified === false) {
        throw new Error("Email Firebase belum terverifikasi.");
      }

      // Entitlement milik BRANN sendiri. Ini TIDAK mengubah lisensi resmi
      // aplikasi pihak ketiga; hanya mencatat hak Premium pada sistem BRANN.
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const dataDir = path.join(__dirname, "..", "data");
      const file = path.join(dataDir, "premium_entitlements.json");
      fs.mkdirSync(dataDir, { recursive: true });

      let entitlements = {};
      try {
        entitlements = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        entitlements = {};
      }

      const now = new Date();
      const days = Math.max(1, parseInt(process.env.BRANN_PREMIUM_DAYS || "30", 10) || 30);
      const expires = new Date(now.getTime() + days * 86400000);
      const codeorder = this.generateCodeOrder();
      const orderId = await this._ensureOrderId();

      const entitlement = {
        uid: user.localId,
        email: String(user.email).toLowerCase(),
        codeorder,
        orderId,
        status: "active",
        source: "firebase-email-link",
        createdAt: now.toISOString(),
        expiresAt: expires.toISOString(),
      };

      entitlements[user.localId] = entitlement;
      fs.writeFileSync(file, JSON.stringify(entitlements, null, 2));

      return {
        success: true,
        codeorder,
        orderId,
        entitlement,
      };
    } catch (error) {
      return {
        success: false,
        error: this._errText(error),
      };
    }
  }}

export default AlightMotionService;
