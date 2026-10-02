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
        // Create default initial key if file doesn't exist
        const defaultKey = {
          key: 'BRANN-DEMO-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
          label: 'Default Key',
          createdAt: new Date().toISOString()
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
      console.log('✅ [ApiKeyManager] Saved API keys');
    } catch (e) {
      console.error('❌ [ApiKeyManager] Failed to save apikeys.json:', e.message);
    }
  }

  getAll() {
    return this.keys;
  }

  addKey(label = 'API Key', customKey = null) {
    const key = customKey && customKey.trim() 
      ? customKey.trim() 
      : 'BRANN-' + crypto.randomBytes(8).toString('hex').toUpperCase();

    // Avoid duplicates
    const existing = this.keys.find(k => k.key === key);
    if (existing) {
      throw new Error('API Key sudah ada!');
    }

    const newEntry = {
      key,
      label: label.trim() || 'API Key',
      createdAt: new Date().toISOString()
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
    if (!key || typeof key !== 'string') return false;
    const cleanKey = key.trim();
    return this.keys.some(k => k.key === cleanKey);
  }
}

module.exports = new ApiKeyManager();
