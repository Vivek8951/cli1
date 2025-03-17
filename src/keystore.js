import fs from 'fs';
import path from 'path';
import CryptoJS from 'crypto-js';

const KEYSTORE_FILE = path.join(process.cwd(), '.keystore');
const ENCRYPTION_KEY = 'depin-storage-secure-key'; // In production, this should be an environment variable

export const savePrivateKey = (privateKey) => {
  try {
    // Encrypt the private key before storing
    const encrypted = CryptoJS.AES.encrypt(privateKey, ENCRYPTION_KEY).toString();
    fs.writeFileSync(KEYSTORE_FILE, encrypted);
    return true;
  } catch (error) {
    console.error('Error saving private key:', error.message);
    return false;
  }
};

export const loadPrivateKey = () => {
  try {
    if (!fs.existsSync(KEYSTORE_FILE)) {
      return null;
    }
    const encrypted = fs.readFileSync(KEYSTORE_FILE, 'utf8');
    const decrypted = CryptoJS.AES.decrypt(encrypted, ENCRYPTION_KEY);
    return decrypted.toString(CryptoJS.enc.Utf8);
  } catch (error) {
    console.error('Error loading private key:', error.message);
    return null;
  }
};

export const clearPrivateKey = () => {
  try {
    if (fs.existsSync(KEYSTORE_FILE)) {
      fs.unlinkSync(KEYSTORE_FILE);
    }
    return true;
  } catch (error) {
    console.error('Error clearing private key:', error.message);
    return false;
  }
};