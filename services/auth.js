import crypto from "crypto";

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

    this.CONTINUE_URL =
      process.env.FIREBASE_CONTINUE_URL ||
      "https://bill-am.firebaseapp.com";

    if (!this.API_KEY) {
      throw new Error(
        "FIREBASE_API_KEY belum diset di Railway Variables."
      );
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

      return typeof data === "object"
        ? JSON.stringify(data)
        : String(data);
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
            canHandleCodeInApp: true,
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
  // Aktivasi Premium pihak ketiga tidak
  // diarahkan ke Firebase bill-am.
  //
  // Method tetap ada agar pemanggil lama
  // tidak mendapat "is not a function".
  // ==========================================

  async applyPremium(idToken) {
    try {
      if (!idToken) {
        return {
          success: false,
          error: "Firebase ID token tidak ditemukan.",
        };
      }

      // BRANN entitlement flow:
      // Firebase hanya dipakai untuk membuktikan kepemilikan email.
      // Tidak ada lagi pemanggilan endpoint aktivasi Premium pihak ketiga.
      const accountRes = await this._post(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${this.API_KEY}`,
        { idToken },
        {
          "Content-Type": "application/json",
        },
        30000
      );

      const firebaseUser = accountRes.data?.users?.[0] || null;
      const email = String(firebaseUser?.email || "").trim().toLowerCase();

      if (!email) {
        return {
          success: false,
          error: "Email akun Firebase tidak ditemukan.",
        };
      }

      const codeorder = this.generateCodeOrder();

      return {
        success: true,
        provider: "brann",
        email,
        firebaseUid: firebaseUser.localId || null,
        codeorder,
        orderId: await this._ensureOrderId(),
        activatedAt: new Date().toISOString(),
        message: "BRANN Premium entitlement berhasil dibuat.",
      };
    } catch (error) {
      return {
        success: false,
        error: this._errText(error),
      };
    }
  }
}

export default AlightMotionService;
