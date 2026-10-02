const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ApiKeyManager {
  constructor() {
    this.filePath = path.join(__dirname, 'apikeys.json');
    this.keys = [];
    this.init();
  }

  init() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        this.keys = JSON.parse(raw);
      } else {
        const defaultKey = {
          key: 'BRANN-DEMO-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
          label: 'Demo User',
          createdAt: new Date().toISOString(),
          tokens: null
        };
        this.keys = [defaultKey];
        this.save();
      }
    } catch (e) {
      console.error('⚠️ [ApiKeyManager] Failed to read apikeys.json:', e.message);
      this.keys = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.keys, null, 2), 'utf8');
    } catch (e) {
      console.error('❌ [ApiKeyManager] Failed to save apikeys.json:', e.message);
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
    this.save();
    return newEntry;
  }

  deleteKey(key) {
    const initialLength = this.keys.length;
    this.keys = this.keys.filter(k => k.key !== key);
    if (this.keys.length === initialLength) {
      throw new Error('API Key tidak ditemukan!');
    }
    this.save();
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
    this.save();
    return true;
  }

  updateAccessToken(key, newAccessToken) {
    const entry = this.getKey(key);
    if (entry && entry.tokens) {
      entry.tokens.accessToken = newAccessToken;
      entry.tokens.lastRefresh = new Date().toISOString();
      this.save();
    }
  }

  getTokens(key) {
    const entry = this.getKey(key);
    return entry ? entry.tokens : null;
  }
}

module.exports = new ApiKeyManager();
