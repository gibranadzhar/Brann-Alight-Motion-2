const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ApiKeyManager {
  constructor() {
    this.candidatePaths = this.resolvePaths();
    this.keys = [];
    this.init();
  }

  resolvePaths() {
    const paths = [];

    // 1. Env STORAGE_PATH or DATA_PATH if set
    if (process.env.STORAGE_PATH) {
      paths.push(process.env.STORAGE_PATH.endsWith('.json') 
        ? process.env.STORAGE_PATH 
        : path.join(process.env.STORAGE_PATH, 'apikeys.json'));
    }
    if (process.env.DATA_PATH) {
      paths.push(process.env.DATA_PATH.endsWith('.json') 
        ? process.env.DATA_PATH 
        : path.join(process.env.DATA_PATH, 'apikeys.json'));
    }

    // 2. Railway volume default paths (/data)
    paths.push('/data/apikeys.json');
    paths.push('/app/data/apikeys.json');

    // 3. Local directory candidate paths
    paths.push(path.join(__dirname, 'data', 'apikeys.json'));
    paths.push(path.join(__dirname, 'apikeys.json'));

    return [...new Set(paths)];
  }

  init() {
    let loadedData = null;

    // Search through candidate paths for existing valid data
    for (const filePath of this.candidatePaths) {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf8');
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            loadedData = parsed;
            console.log(`✅ [ApiKeyManager] Loaded ${parsed.length} keys from ${filePath}`);
            break;
          }
        }
      } catch (e) {
        // Skip unreadable paths
      }
    }

    if (loadedData) {
      this.keys = loadedData;
      this.save(false); // save without triggering duplicate github push on boot
    } else {
      const defaultKey = {
        key: 'BRANN-DEMO-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        label: 'Demo User',
        createdAt: new Date().toISOString(),
        tokens: null
      };
      this.keys = [defaultKey];
      this.save(false);
    }

    // Try sync initial load from GitHub if remote repo has newer keys
    this.fetchFromGitHub();
  }

  save(shouldSyncToGitHub = true) {
    if (!Array.isArray(this.keys)) return;
    const jsonStr = JSON.stringify(this.keys, null, 2);

    for (const filePath of this.candidatePaths) {
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, jsonStr, 'utf8');
      } catch (e) {
        // Silently skip read-only paths
      }
    }

    if (shouldSyncToGitHub) {
      this.syncToGitHub();
    }
  }

  async fetchFromGitHub() {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const repo = process.env.GITHUB_REPO || 'gibranadzhar/Brann-Merchant';
    if (!token) return;

    try {
      const url = `https://api.github.com/repos/${repo}/contents/apikeys.json`;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Brann-Merchant-Server'
      };
      const res = typeof fetch !== 'undefined' ? await fetch(url, { headers }) : null;
      if (res && res.ok) {
        const data = await res.json();
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.keys = parsed;
          console.log(`✅ [ApiKeyManager] Synced ${parsed.length} database keys from GitHub (${repo})`);
          this.save(false);
        }
      }
    } catch (e) {
      console.warn(`⚠️ [ApiKeyManager] Could not fetch remote keys from GitHub:`, e.message);
    }
  }

  async syncToGitHub() {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const repo = process.env.GITHUB_REPO || 'gibranadzhar/Brann-Merchant';
    if (!token) return;

    try {
      const url = `https://api.github.com/repos/${repo}/contents/apikeys.json`;
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Brann-Merchant-Server'
      };

      let sha = null;
      if (typeof fetch !== 'undefined') {
        try {
          const getRes = await fetch(url, { headers });
          if (getRes.ok) {
            const getData = await getRes.json();
            sha = getData.sha;
          }
        } catch (e) {}

        const contentBase64 = Buffer.from(JSON.stringify(this.keys, null, 2)).toString('base64');
        const putBody = {
          message: 'auto(db): sync apikeys.json database update from server',
          content: contentBase64,
          branch: 'main'
        };
        if (sha) putBody.sha = sha;

        const putRes = await fetch(url, {
          method: 'PUT',
          headers,
          body: JSON.stringify(putBody)
        });

        if (putRes.ok) {
          console.log(`✅ [ApiKeyManager] Auto-committed & pushed updated database to GitHub (${repo})!`);
        } else {
          const errText = await putRes.text();
          console.error(`⚠️ [ApiKeyManager] GitHub API push failed (${putRes.status}):`, errText);
        }
      }
    } catch (e) {
      console.error(`⚠️ [ApiKeyManager] GitHub auto-sync failed:`, e.message);
    }
  }

  getAll() {
    return this.keys;
  }

  getKey(key) {
    if (!key || typeof key !== 'string') return null;
    const cleanKey = key.trim();
    return this.keys.find(k => k.key === cleanKey) || null;
  }

  addKey(label = 'API Key', customKey = null) {
    const key = customKey && customKey.trim() 
      ? customKey.trim() 
      : 'BRANN-' + crypto.randomBytes(8).toString('hex').toUpperCase();

    const existing = this.keys.find(k => k.key === key);
    if (existing) {
      throw new Error('API Key sudah ada!');
    }

    const newEntry = {
      key,
      label: label.trim() || 'API Key',
      createdAt: new Date().toISOString(),
      tokens: null
    };

    this.keys.push(newEntry);
    this.save(true);
    return newEntry;
  }

  deleteKey(key) {
    const initialLength = this.keys.length;
    this.keys = this.keys.filter(k => k.key !== key);
    if (this.keys.length === initialLength) {
      throw new Error('API Key tidak ditemukan!');
    }
    this.save(true);
    return true;
  }

  isValid(key) {
    return !!this.getKey(key);
  }

  setTokens(key, accessToken, refreshToken) {
    const entry = this.getKey(key);
    if (!entry) {
      throw new Error('API Key tidak ditemukan!');
    }
    entry.tokens = {
      accessToken,
      refreshToken,
      lastRefresh: new Date().toISOString()
    };
    this.save(true);
    return true;
  }

  updateAccessToken(key, newAccessToken) {
    const entry = this.getKey(key);
    if (entry && entry.tokens) {
      entry.tokens.accessToken = newAccessToken;
      entry.tokens.lastRefresh = new Date().toISOString();
      this.save(true);
    }
  }

  getTokens(key) {
    const entry = this.getKey(key);
    return entry ? entry.tokens : null;
  }
}

module.exports = new ApiKeyManager();
