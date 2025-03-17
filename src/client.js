import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import CryptoJS from 'crypto-js';
import { create } from 'ipfs-http-client';
import { promises as fs } from 'fs';
import path from 'path';
import Web3 from 'web3';
import HDWalletProvider from '@truffle/hdwallet-provider';
import { getOnlineProviders } from './provider.js';
import { savePrivateKey, loadPrivateKey } from './keystore.js';
import { trackFileStorage } from './supabase.js';

// BSC Testnet configuration
const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
const AAI_TOKEN_ADDRESS = '0xd5F6a56c8B273854fbd135239FcbcC2B8142585a'; // BSC testnet AAI token address
const STORAGE_CONTRACT_ADDRESS = '0xD87FC38Eab64Ddde4dED5D1c020Ea5EF1a69f412'; // Storage contract address
const STORAGE_CONTRACT_ABI = [
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

const AAI_TOKEN_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "_owner", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "balance", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [
      {"name": "_to", "type": "address"},
      {"name": "_value", "type": "uint256"}
    ],
    "name": "transfer",
    "outputs": [{"name": "success", "type": "bool"}],
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [
      {"name": "_spender", "type": "address"},
      {"name": "_value", "type": "uint256"}
    ],
    "name": "approve",
    "outputs": [{"name": "success", "type": "bool"}],
    "type": "function"
  }
];

export async function startClient() {
  try {
    // Get client wallet details first
    let privateKey = loadPrivateKey();
    
    if (!privateKey) {
      const walletDetails = await inquirer.prompt([
        {
          type: 'password',
          name: 'privateKey',
          message: 'Enter your BSC wallet private key (for paying AAI tokens):',
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
      // Save the private key for future use
      savePrivateKey(privateKey);
    }

    // Initialize Web3 with BSC testnet
    const provider = new HDWalletProvider(privateKey, BSC_TESTNET_RPC);
    const web3 = new Web3(provider);
    const accounts = await web3.eth.getAccounts();
    const walletAddress = accounts[0];

    console.log(chalk.green(`Connected to BSC Testnet with address: ${walletAddress}`));

    // Get online providers
    // Get online providers with improved error handling and validation
    const getProvidersWithRetry = async (maxRetries = 3, retryDelay = 5000) => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const providers = await getOnlineProviders();
          if (providers && providers.length > 0) {
            // Validate provider data
            const validProviders = providers.filter(([id, provider]) => {
              const isActive = id && provider && provider.address && 
                     provider.storage > 0 && provider.price && 
                     provider.lastSeen > Date.now() - 300000; // Active in last 5 minutes
              
              // Additional validation for price and storage
              if (isActive) {
                console.log(chalk.blue(`Found active provider ${id} with price ${provider.price} AAI/GB`));
                return true;
              }
              return false;
            });
            if (validProviders.length > 0) {
              return validProviders;
            }
          }
          console.log(chalk.yellow(`No valid providers found, retrying in ${retryDelay/1000} seconds... (Attempt ${i + 1}/${maxRetries})`));
        } catch (error) {
          console.error(chalk.red(`Error fetching providers (Attempt ${i + 1}/${maxRetries}):`, error.message));
        }
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
      throw new Error('No storage providers available. Please try again later.');
    };

    const onlineProviders = await getProvidersWithRetry();
    
    // Format provider choices with detailed information
    const providerChoices = onlineProviders.map(([id, provider]) => ({
      name: `Provider ${id} (${provider.storage}GB available at ${provider.price} AAI/GB)\n  Address: ${provider.address}\n  Last Seen: ${new Date(provider.lastSeen).toLocaleString()}`,
      value: { id, ...provider }
    }));

    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Select a storage provider:',
        choices: providerChoices
      },
      {
        type: 'number',
        name: 'storage',
        message: 'How much storage would you like to purchase (in GB)?',
        validate: (input, answers) => {
          if (isNaN(input) || input <= 0) {
            return 'Please enter a valid number greater than 0';
          }
          const selectedProvider = answers.provider;
          if (input > selectedProvider.storage) {
            return `Provider only has ${selectedProvider.storage}GB available`;
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'filePath',
        message: 'Enter the path to the file you want to upload:',
        validate: async (input, { storage }) => {
          try {
            // Normalize the file path to handle Windows paths correctly
            const normalizedPath = path.normalize(input);
            const stats = await fs.stat(normalizedPath);
            
            if (!stats.isFile()) {
              return 'The specified path is not a file';
            }
            
            const fileSizeGB = stats.size / (1024 * 1024 * 1024);
            if (fileSizeGB > storage) {
              return `File size (${fileSizeGB.toFixed(2)}GB) exceeds requested storage (${storage}GB)`;
            }
            return true;
          } catch (error) {
            if (error.code === 'ENOENT') {
              return 'File does not exist at the specified path';
            } else if (error.code === 'EACCES') {
              return 'Cannot access the file. Please check file permissions';
            }
            return `Cannot access the file: ${error.message}`;
          }
        }
      }
    ]);

    const spinner = ora('Processing your request...').start();

    // Initialize AAI token contract
    const aaiToken = new web3.eth.Contract(AAI_TOKEN_ABI, AAI_TOKEN_ADDRESS);

    // Calculate payment amount
    const paymentAmount = web3.utils.toWei(
      (parseFloat(answers.storage) * parseFloat(answers.provider.price)).toString(),
      'ether'
    );

    // Check token balance and convert to same decimal format
    const balance = await aaiToken.methods.balanceOf(walletAddress).call();
    const balanceInEther = web3.utils.fromWei(balance, 'ether');
    const paymentInEther = web3.utils.fromWei(paymentAmount, 'ether');

    if (parseFloat(balanceInEther) < parseFloat(paymentInEther)) {
      spinner.fail(`Insufficient AAI token balance. Required: ${paymentInEther} AAI, Available: ${balanceInEther} AAI`);
      return;
    }

    // Initialize storage contract
    const storageContract = new web3.eth.Contract(STORAGE_CONTRACT_ABI, STORAGE_CONTRACT_ADDRESS);

    // Process payment and purchase storage
    spinner.text = 'Processing payment and purchasing storage...';
    try {
      // Approve token transfer
      await aaiToken.methods.approve(STORAGE_CONTRACT_ADDRESS, paymentAmount)
        .send({ from: walletAddress });

      // Purchase storage through contract
      await storageContract.methods.purchaseStorage(answers.provider.address, answers.storage)
        .send({ from: walletAddress });

      spinner.succeed('Storage purchased successfully');
    } catch (error) {
      spinner.fail('Storage purchase failed');
      console.error(chalk.red('Error:', error.message));
      return;
    }

    // Handle file upload
    try {
      const file = await fs.readFile(answers.filePath);
      const fileName = path.basename(answers.filePath);
      
      // Generate a secure encryption key
      spinner.text = 'Generating encryption key...';
      const salt = CryptoJS.lib.WordArray.random(128/8);
      const encryptionKey = CryptoJS.PBKDF2(walletAddress + privateKey, salt, {
        keySize: 256/32,
        iterations: 10000
      });
      
      // Encrypt file content with AES-256
      spinner.text = 'Encrypting file with AES-256...';
      const encrypted = CryptoJS.AES.encrypt(file.toString(), encryptionKey.toString(), {
        mode: CryptoJS.mode.CBC,
        padding: CryptoJS.pad.Pkcs7,
        iv: CryptoJS.lib.WordArray.random(128/8)
      }).toString();

      // Connect to provider's IPFS node
      spinner.text = 'Connecting to provider\'s IPFS node...';
      const ipfs = create({ url: 'http://127.0.0.1:5001' });
      
      // Verify provider's storage capacity and convert file size
      const fileSizeBytes = file.length;
      // Calculate file size in GB with higher precision for small files
      const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);
      
      // Convert file size to milliether format for contract interaction
      // Ensure minimum size of 1 milliether for small files to match contract logic
      const fileSizeWei = web3.utils.toBN(
        Math.max(Math.ceil(fileSizeBytes / 1000), 1).toString()
      );
      
      const sizeDisplay = fileSizeGB < 1 ? 
        `${(fileSizeGB * 1024).toFixed(2)}MB` : 
        `${fileSizeGB.toFixed(2)}GB`;
      
      if (fileSizeGB > answers.provider.storage) {
        spinner.fail(`File size (${sizeDisplay}) exceeds provider's available storage (${answers.provider.storage}GB)`);
        return;
      }
      
      // Upload to IPFS through provider's node
      spinner.text = `Uploading file (${sizeDisplay}) to IPFS...`;
      const result = await ipfs.add(encrypted);

      // Track file storage in Supabase with exact file size
      await trackFileStorage({
        cid: result.path,
        providerId: answers.provider.id,
        clientAddress: walletAddress,
        fileSize: fileSizeGB,
        fileName: fileName,
        salt: salt.toString()
      });

      // Register file storage in contract using Wei format
      spinner.text = 'Registering file in smart contract...';
      await storageContract.methods.storeFile(
        answers.provider.address,
        result.path,
        fileSizeWei
      ).send({ from: walletAddress });

      spinner.succeed('File uploaded and registered successfully!');
      console.log(chalk.green(`\nFile CID: ${result.path}`));
      console.log(chalk.yellow('Store this CID safely for future retrieval!'));
      console.log(chalk.blue(`Provider Address: ${answers.provider.address}`));

    } catch (error) {
      spinner.fail('Upload failed');
      console.error(chalk.red('Error:', error.message));
    }

  } catch (error) {
    console.error(chalk.red('Error:', error.message));
  }
}