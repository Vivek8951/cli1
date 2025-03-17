import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import CryptoJS from 'crypto-js';
import { create } from 'ipfs-http-client';
import { promises as fs } from 'fs';
import path from 'path';
import Web3 from 'web3';
import HDWalletProvider from '@truffle/hdwallet-provider';
import { loadPrivateKey, savePrivateKey } from './keystore.js';
import { supabase } from './supabase.js';

// BSC Testnet configuration
const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
const STORAGE_CONTRACT_ADDRESS = '0xD87FC38Eab64Ddde4dED5D1c020Ea5EF1a69f412';
const STORAGE_CONTRACT_ABI = [
  {
    "inputs": [{ "name": "_cid", "type": "string" }],
    "name": "getFileDetails",
    "outputs": [
      { "name": "provider", "type": "address" },
      { "name": "owner", "type": "address" },
      { "name": "fileSize", "type": "uint256" }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "name": "_provider", "type": "address" }, { "name": "_storageAmount", "type": "uint256" }],
    "name": "purchaseStorage",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "name": "_provider", "type": "address" }, { "name": "_cid", "type": "string" }, { "name": "_fileSize", "type": "uint256" }],
    "name": "storeFile",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

async function debugIPFSConnection() {
  try {
    const ipfs = create({ url: 'http://127.0.0.1:5001' });
    const isOnline = await ipfs.isOnline();
    console.log('IPFS Debug:', {
      isOnline,
      nodeVersion: await ipfs.version(),
      peerId: (await ipfs.id()).id
    });
    return ipfs;
  } catch (error) {
    console.error('IPFS Connection Error:', error);
    return null;
  }
}

export async function downloadFile() {
  let provider;
  let downloadDetails;
  const spinner = ora('Processing your request...').start();

  try {
    // Get file details from user
    downloadDetails = await inquirer.prompt([
      {
        type: 'input',
        name: 'cid',
        message: 'Enter the CID of the file you want to download:',
        validate: input => input && input.trim().length > 0 ? true : 'CID cannot be empty'
      },
      {
        type: 'input',
        name: 'outputPath',
        message: 'Enter the path where you want to save the file:',
        validate: async (input) => {
          try {
            const normalizedPath = path.normalize(input);
            const dir = path.dirname(normalizedPath);
            await fs.access(dir);
            return true;
          } catch (error) {
            return 'Invalid directory path or directory does not exist';
          }
        }
      }
    ]);

    // Get client wallet details
    let privateKey = loadPrivateKey();
    
    if (!privateKey) {
      const walletDetails = await inquirer.prompt([
        {
          type: 'password',
          name: 'privateKey',
          message: 'Enter your BSC wallet private key to verify file ownership:',
          validate: input => {
            if (!input) return 'Private key cannot be empty';
            if (!(input.length === 64 || input.startsWith('0x'))) {
              return 'Invalid private key format. Must be 64 characters or start with 0x';
            }
            return true;
          }
        }
      ]);

      if (!walletDetails || !walletDetails.privateKey) {
        throw new Error('Wallet details not provided');
      }

      privateKey = walletDetails.privateKey;
      savePrivateKey(privateKey);
    }

    // Initialize Web3 with BSC testnet
    provider = new HDWalletProvider(privateKey, BSC_TESTNET_RPC);
    const web3 = new Web3(provider);
    const accounts = await web3.eth.getAccounts();
    const walletAddress = accounts[0];

    console.log('Wallet Debug:', {
      address: walletAddress,
      network: await web3.eth.net.getId()
    });

    // Before contract interaction, add database check
    const { data: dbCheck, error: dbError } = await supabase
      .from('stored_files')
      .select('*')
      .eq('cid', downloadDetails.cid)
      .single();

    console.log('Database Entry:', dbCheck);
    if (dbError) {
      console.error('Database Error:', dbError);
      spinner.fail('Failed to verify file in database');
      return;
    }

    // Before IPFS operations, add connection check
    const ipfs = await debugIPFSConnection();
    if (!ipfs) {
      spinner.fail('Failed to connect to IPFS node');
      return;
    }

    try {
      // Initialize storage contract
      const storageContract = new web3.eth.Contract(STORAGE_CONTRACT_ABI, STORAGE_CONTRACT_ADDRESS);

      // Get file details from contract
      spinner.text = 'Verifying file ownership and size...';
      const fileDetails = await storageContract.methods
        .getFileDetails(downloadDetails.cid)
        .call({ from: walletAddress });

      console.log('Smart Contract Response:', {
        fileDetails,
        raw: JSON.stringify(fileDetails, null, 2)
      });

      // Verify file exists and has valid details
      if (!fileDetails || !Array.isArray(fileDetails) || fileDetails.length !== 3) {
        spinner.fail('File not found or invalid file details. Please check if the CID is correct.');
        return;
      }

      const [providerAddress, ownerAddress, fileSize] = fileDetails;

      if (!ownerAddress || ownerAddress === '0x0000000000000000000000000000000000000000') {
        spinner.fail('File not found or access denied. Please check if you are the owner of this file.');
        return;
      }

      if (!providerAddress || providerAddress === '0x0000000000000000000000000000000000000000') {
        spinner.fail('Invalid file details. Provider information not found.');
        return;
      }

      // Verify ownership with case-insensitive comparison
      if (ownerAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        spinner.fail('You do not have permission to download this file. Only the owner can download it.');
        return;
      }

      // Get file size from database for accurate reporting
      const { data: fileMetadata, error: metadataError } = await supabase
        .from('stored_files')
        .select('file_size')
        .eq('cid', downloadDetails.cid)
        .single();

      if (metadataError || !fileMetadata) {
        spinner.fail('Could not retrieve file metadata');
        return;
      }

      // Display accurate file size from database
      const fileSizeGB = fileMetadata.file_size;
      const sizeDisplay = fileSizeGB < 1 ? 
        `${(fileSizeGB * 1024).toFixed(2)}MB` : 
        `${fileSizeGB.toFixed(2)}GB`;
    
      spinner.info(`File size: ${sizeDisplay}`);
      
      // Connect to provider's IPFS node
      spinner.text = 'Connecting to IPFS...';
      const ipfs = create({ url: 'http://127.0.0.1:5001' });
      console.log('IPFS node connection status:', ipfs.isOnline());

      // Download encrypted file from IPFS
      spinner.text = 'Downloading encrypted file from IPFS...';
      const chunks = [];
      for await (const chunk of ipfs.cat(downloadDetails.cid)) {
        chunks.push(chunk);
      }
      const encryptedContent = Buffer.concat(chunks);

      // Get encryption salt from database
      spinner.text = 'Retrieving encryption details...';
      const { data: fileData, error: saltError } = await supabase
        .from('stored_files')
        .select('encryption_salt, file_size')
        .eq('cid', downloadDetails.cid)
        .single();

      if (saltError || !fileData?.encryption_salt) {
        spinner.fail('Could not retrieve file encryption details');
        return;
      }

      // Generate decryption key
      spinner.text = 'Decrypting file...';
      const encryptionKey = CryptoJS.PBKDF2(walletAddress + privateKey, fileData.encryption_salt, {
        keySize: 256/32,
        iterations: 10000
      });

      // Convert the binary buffer to WordArray for CryptoJS
      const encryptedWordArray = CryptoJS.lib.WordArray.create(encryptedContent);
      const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: encryptedWordArray },
        encryptionKey,
        {
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7
        }
      );

      // Convert decrypted data to Buffer maintaining binary integrity
      const fileContent = Buffer.from(decrypted.toString(CryptoJS.enc.Base64), 'base64');

      // Save file to specified location
      spinner.text = 'Saving file...';
      await fs.writeFile(downloadDetails.outputPath, fileContent);

      spinner.succeed('File downloaded and decrypted successfully!');
      console.log(chalk.green(`\nFile saved to: ${downloadDetails.outputPath}`));

    } catch (error) {
      spinner.fail('Error verifying file details');
      console.error(chalk.red('Error:', error.message));
      throw error; // Propagate error to outer catch block
    }

  } catch (error) {
    console.error('Download Error:', {
      message: error.message,
      stack: error.stack
    });
    spinner.fail(`Download failed: ${error.message}`);
  } finally {
    if (provider) {
      provider.engine.stop();
    }
  }
}