import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private key: CryptoKey | null = null;
  private ready: Promise<void>;
  private readonly SALT_KEY = 'leprosy-salt-v2';
  // CHANGE THIS - this is your inbuilt PIN. Obfuscated but in bundle.
  // This is NOT high security, but stops casual DB reading, which is what you want.
  private readonly INBUILT_SECRET = 'LEP-RAT-2024-!@#_ThRathnapura_Secure_19';

  constructor() {
    // Auto-unlock on app start - THIS FIXES OFFLINE
    this.ready = this.initAutoKey();
  }

  private async initAutoKey(): Promise<void> {
    // Try load persisted CryptoKey from IndexedDB first (best)
    const storedKey = await this.loadKeyFromIDB();
    if (storedKey) {
      this.key = storedKey;
      return;
    }
    // Fallback: derive from inbuilt secret + salt (always works offline)
    await this.deriveKeyFromInbuiltSecret();
    // Persist it for next time
    await this.saveKeyToIDB(this.key!);
  }

  private async deriveKeyFromInbuiltSecret(): Promise<CryptoKey> {
    const salt:any = this.getOrCreateSalt();
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(this.INBUILT_SECRET), 'PBKDF2', false, ['deriveKey']
    );
    this.key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    return this.key;
  }

  // --- IndexedDB key persistence (makes key non-extractable and survives refresh) ---
  private async saveKeyToIDB(key: CryptoKey): Promise<void> {
    return new Promise((resolve) => {
      const req = indexedDB.open('leprosy-crypto', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('keys', 'readwrite');
        tx.objectStore('keys').put(key, 'main-key');
        tx.oncomplete = () => resolve();
      };
      req.onerror = () => resolve(); // fail silently, we have derived key anyway
    });
  }

  private async loadKeyFromIDB(): Promise<CryptoKey | null> {
    return new Promise((resolve) => {
      const req = indexedDB.open('leprosy-crypto', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('keys');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('keys', 'readonly');
        const getReq = tx.objectStore('keys').get('main-key');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    });
  }

  private getOrCreateSalt(): Uint8Array {
    let saltStr = localStorage.getItem(this.SALT_KEY);
    if (!saltStr) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      saltStr = btoa(String.fromCharCode(...salt));
      localStorage.setItem(this.SALT_KEY, saltStr);
    }
    const decoded = atob(saltStr);
    const arr = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) arr[i] = decoded.charCodeAt(i);
    return arr;
  }

  // --- Public API - wait for ready ---
  async encrypt<T>(data: T): Promise<string> {
    await this.ready;
    if (!this.key) throw new Error('Crypto not ready');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, this.key, new TextEncoder().encode(JSON.stringify(data))
    );
    const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipher), iv.byteLength);
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt<T>(encrypted: string): Promise<T> {
    await this.ready;
    if (!this.key) throw new Error('Crypto not ready');
    const binary = atob(encrypted);
    const combined = Uint8Array.from(binary, c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, this.key, data);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // No more PIN
  isUnlocked(): boolean { return true; }
  async ensureReady() { await this.ready; }
}