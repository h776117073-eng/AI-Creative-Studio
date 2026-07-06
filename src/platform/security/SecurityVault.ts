export class SecurityVault {
  private static instance: SecurityVault | null = null;
  private cryptoKey: CryptoKey | null = null;

  private constructor() {
    this.generateLocalKey();
  }

  public static getInstance(): SecurityVault {
    if (!SecurityVault.instance) {
      SecurityVault.instance = new SecurityVault();
    }
    return SecurityVault.instance;
  }

  /**
   * Generates a persistent or session-based cryptographic key for local workspaces
   */
  private async generateLocalKey(): Promise<void> {
    if (typeof window === "undefined" || !window.crypto || !window.crypto.subtle) {
      return;
    }

    try {
      this.cryptoKey = await window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256,
        },
        true, // extractable
        ["encrypt", "decrypt"]
      );
    } catch (e) {
      console.error("[SecurityVault] Web Crypto key generation failed:", e);
    }
  }

  /**
   * High performance local asset encryption (AES-GCM)
   */
  public async encryptData(payload: string): Promise<{ cipherTextHex: string; ivHex: string } | null> {
    if (!this.cryptoKey || typeof window === "undefined") return null;

    try {
      const encoder = new TextEncoder();
      const rawData = encoder.encode(payload);
      
      // Generate secure random 12-byte initialization vector
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      
      const cipherBuffer = await window.crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: iv,
        },
        this.cryptoKey,
        rawData
      );

      // Translate typed arrays to hexadecimal representations for local DB persistence
      const cipherTextHex = this.bufToHex(new Uint8Array(cipherBuffer));
      const ivHex = this.bufToHex(iv);

      return { cipherTextHex, ivHex };
    } catch (err) {
      console.error("[SecurityVault] AES encryption failure:", err);
      return null;
    }
  }

  /**
   * Decrypts previously encrypted hex-strings back into clean plaintext
   */
  public async decryptData(cipherTextHex: string, ivHex: string): Promise<string | null> {
    if (!this.cryptoKey || typeof window === "undefined") return null;

    try {
      const cipherBytes = this.hexToBuf(cipherTextHex);
      const ivBytes = this.hexToBuf(ivHex);

      const plainBuffer = await window.crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: ivBytes,
        },
        this.cryptoKey,
        cipherBytes
      );

      const decoder = new TextDecoder();
      return decoder.decode(plainBuffer);
    } catch (err) {
      console.error("[SecurityVault] AES decryption failure:", err);
      return null;
    }
  }

  private bufToHex(buffer: Uint8Array): string {
    return Array.from(buffer)
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }

  private hexToBuf(hexString: string): Uint8Array {
    const matches = hexString.match(/.{1,2}/g) || [];
    return new Uint8Array(matches.map(byte => parseInt(byte, 16)));
  }
}
