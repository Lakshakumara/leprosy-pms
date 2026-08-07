import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class CryptoService {
  private key: CryptoKey | null = null;
  private readonly SALT_KEY = 'leprosy-salt';
  private readonly PIN_HASH_KEY = 'leprosy-pin-hash';

  async deriveKeyFromPin(pin: string): Promise<CryptoKey> {
    const salt = this.getOrCreateSalt();
    const enc = new TextEncoder();

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(pin) as BufferSource,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as BufferSource, // <-- FIX HERE
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'] as KeyUsage[] // <-- FIX HERE
    );
    return this.key;
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

  async encrypt<T>(data: T): Promise<string> {
    if (!this.key) throw new Error('No key - unlock first');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();

    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource }, // <-- FIX HERE
      this.key,
      enc.encode(JSON.stringify(data)) as BufferSource
    );

    const combined = new Uint8Array(iv.byteLength + cipher.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(cipher), iv.byteLength);
    return btoa(String.fromCharCode(...combined));
  }

  async decrypt<T>(encrypted: string): Promise<T> {
    if (!this.key) throw new Error('No key - unlock first');
    const binary = atob(encrypted);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) combined[i] = binary.charCodeAt(i);

    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource }, // <-- FIX HERE
      this.key,
      data as BufferSource
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async setPin(pin: string): Promise<void> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin) as BufferSource);
    localStorage.setItem(this.PIN_HASH_KEY, btoa(String.fromCharCode(...new Uint8Array(hash))));
    await this.deriveKeyFromPin(pin);
  }

  async verifyPin(pin: string): Promise<boolean> {
    const stored = localStorage.getItem(this.PIN_HASH_KEY);
    if (!stored) return false;
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin) as BufferSource);
    const hashStr = btoa(String.fromCharCode(...new Uint8Array(hash)));
    return hashStr === stored;
  }

  lock(): void { this.key = null; }
  isUnlocked(): boolean { return!!this.key; }
}