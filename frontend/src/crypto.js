// Oda şifresinden 256-bit AES-GCM anahtarı türetir
export async function deriveKey(password, salt = 'e2ee-room-salt-2026') {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: enc.encode(salt),
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Mesajı AES-GCM ile şifreler
export async function encryptMessage(text, key) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit benzersiz IV
  const encoded = enc.encode(text);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );

  return {
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    iv: Array.from(iv)
  };
}

// Gelen şifreli mesajı çözer
export async function decryptMessage(encryptedData, key) {
  try {
    const ciphertext = new Uint8Array(encryptedData.ciphertext);
    const iv = new Uint8Array(encryptedData.iv);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch {
    return '[Şifre çözülemedi / Yanlış anahtar]';
  }
}