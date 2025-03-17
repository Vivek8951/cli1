import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import Web3 from 'web3';
import HDWalletProvider from '@truffle/hdwallet-provider';
import * as IPFS from 'ipfs-http-client';
import { savePrivateKey, loadPrivateKey } from './keystore.js';
import { createProvider, updateProviderStorage, getProviderFiles } from './supabase.js';

const execAsync = promisify(exec);

// BSC Testnet configuration
const BSC_TESTNET_RPC = 'https://data-seed-prebsc-1-s1.binance.org:8545/';
const AAI_TOKEN_ADDRESS = '0xd5F6a56c8B273854fbd135239FcbcC2B8142585a';
const STORAGE_CONTRACT_ADDRESS = '0xD87FC38Eab64Ddde4dED5D1c020Ea5EF1a69f412';
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
  }
];

import fs from 'fs';
import path from 'path';

const PROVIDERS_FILE = path.join(process.cwd(), '.providers.json');
const onlineProviders = new Map();

// Function to load providers from file
const loadProviders = () => {
  try {
    if (fs.existsSync(PROVIDERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROVIDERS_FILE, 'utf8'));
      return new Map(Object.entries(data));
    }
  } catch (error) {
    console.error('Error loading providers:', error);
  }
  return new Map();
};

// Function to save providers to file
const saveProviders = (providers) => {
  try {
    const data = Object.fromEntries(providers);
    fs.writeFileSync(PROVIDERS_FILE, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving providers:', error);
  }
};

// Function to update provider status
const updateProviderStatus = (providerId, provider) => {
  const providers = loadProviders();
  const serializableProvider = {
    address: provider.address,
    storage: provider.storage,
    price: provider.price,
    lastSeen: Date.now()
  };
  providers.set(providerId, serializableProvider);
  onlineProviders.set(providerId, provider); // Keep full object in memory
  saveProviders(providers); // Save only serializable data
};

// Initialize storage contract ABI
const STORAGE_CONTRACT_ABI = [
  {
    "inputs": [{ "name": "_storage", "type": "uint256" }, { "name": "_pricePerGB", "type": "uint256" }],
    "name": "registerProvider",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "distributeMiningRewards",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

// Function to check actual available storage
async function checkAvailableStorage() {
  try {
    const { stdout } = await execAsync('wmic logicaldisk get freespace,caption');
    const lines = stdout.trim().split('\n');
    let totalFreeGB = 0;
    
    // Skip header line and process each drive
    for (let i = 1; i < lines.length; i++) {
      const [drive, freeSpace] = lines[i].trim().split(/\s+/);
      if (drive && freeSpace) {
        totalFreeGB += Math.floor(parseInt(freeSpace) / (1024 * 1024 * 1024));
      }
    }
    return totalFreeGB;
  } catch (error) {
    console.error(chalk.red('Error checking storage:', error.message));
    return 0;
  }
}

// Function to verify and update provider storage
async function verifyProviderStorage(providerId, allocatedStorage) {
  const availableStorage = await checkAvailableStorage();
  if (availableStorage < allocatedStorage) {
    console.log(chalk.yellow(`Warning: Requested storage (${allocatedStorage}GB) exceeds available storage (${availableStorage}GB)`));
    return availableStorage;
  }
  return allocatedStorage;
}

export const startProvider = async () => {
  const spinner = ora('Starting DePIN Storage Provider...').start();
  let provider;
  
  try {
    // Check and initialize IPFS
    spinner.text = 'Checking IPFS installation and daemon status...';
    try {
      // Check IPFS installation
      await execAsync('ipfs --version');
      spinner.succeed('IPFS is installed');

      // Check if IPFS daemon is already running
      try {
        await execAsync('ipfs swarm peers');
        spinner.info('IPFS daemon already running');
      } catch {
        // Initialize IPFS if not already initialized
        spinner.text = 'Initializing IPFS...';
        try {
          await execAsync('ipfs init');
          spinner.succeed('IPFS initialized successfully');
        } catch (initError) {
          if (!initError.message.includes('already initialized')) {
            throw initError;
          }
          spinner.info('IPFS already initialized');
        }

        // Start IPFS daemon
        spinner.text = 'Starting IPFS daemon...';
        const daemonProcess = exec('ipfs daemon', (error) => {
          if (error) {
            console.error(chalk.red('IPFS daemon error:', error.message));
          }
        });
        // Wait for daemon to start
        await new Promise(resolve => setTimeout(resolve, 3000));
        spinner.succeed('IPFS daemon started successfully');
      }
    } catch (error) {
      spinner.fail('IPFS setup failed');
      console.error(chalk.red('Error:', error.message));
      return;
    }

    // Try to load existing private key
    let privateKey = loadPrivateKey();
    
    if (!privateKey) {
      // Get wallet details only if no stored key exists
      spinner.start('Waiting for wallet details...');
      const walletDetails = await inquirer.prompt([
        {
          type: 'password',
          name: 'privateKey',
          message: 'Enter your BSC wallet private key (for receiving AAI tokens):',
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

    // Initialize Web3 provider
    spinner.text = 'Initializing Web3 provider...';
    provider = new HDWalletProvider(privateKey, BSC_TESTNET_RPC);
    const web3 = new Web3(provider);
    const accounts = await web3.eth.getAccounts();
    const walletAddress = accounts[0];
    spinner.succeed(`Connected to BSC Testnet with address: ${walletAddress}`);

    // Get storage configuration with fixed price
    spinner.start('Waiting for storage configuration...');
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'storage',
        message: 'How much storage would you like to allocate (in GB)?',
        validate: input => !isNaN(input) && parseInt(input) > 0
      }
    ]);
    
    // Set fixed price of 10 AAI per GB
    answers.price = 10;

    // Connect to IPFS
    spinner.text = 'Connecting to IPFS node...';
    try {
      const ipfs = IPFS.create({ url: 'http://127.0.0.1:5001' });
      const version = await ipfs.version();
      spinner.succeed(`Successfully connected to IPFS node (version ${version.version})`);

      // Get actual system storage and verify
      const availableStorage = await checkAvailableStorage();
      const verifiedStorage = Math.min(parseInt(answers.storage), availableStorage);
      
      // Generate a unique provider ID based on wallet address
      const providerId = web3.utils.keccak256(walletAddress).slice(2, 10);
      
      // Initialize storage contract
      const storageContract = new web3.eth.Contract(STORAGE_CONTRACT_ABI, STORAGE_CONTRACT_ADDRESS);
      
      // Register provider on the smart contract
      spinner.text = 'Registering provider on blockchain and database...';
      try {
        // Register on blockchain
        await storageContract.methods.registerProvider(
          web3.utils.toWei(verifiedStorage.toString(), 'ether'),
          web3.utils.toWei(answers.price.toString(), 'ether')
        ).send({ from: walletAddress });

        // Register in Supabase with proper error handling
        try {
          await createProvider({
            id: providerId,
            address: walletAddress,
            storage: verifiedStorage,
            price: answers.price,
            totalStorage: availableStorage,
            availableStorage: availableStorage,
            is_active: true,
            last_updated: new Date().toISOString()
          });
          spinner.succeed('Provider registered successfully');
        } catch (dbError) {
          if (dbError.message.includes('providers_pkey')) {
            // Provider already exists, update their record
            await updateProviderStorage(providerId, {
              allocated: verifiedStorage,
              available: availableStorage,
              last_updated: new Date().toISOString()
            });
            spinner.succeed('Provider information updated successfully');
          } else {
            throw dbError;
          }
        }

        // Update local provider status
        updateProviderStatus(providerId, {
          address: walletAddress,
          storage: verifiedStorage,
          price: answers.price,
          lastSeen: Date.now(),
          ipfsNode: ipfs,
          contract: storageContract
        });

        // Set up storage monitoring interval with error handling
        const monitorStorage = async () => {
          try {
            const currentStorage = await checkAvailableStorage();
            const files = await getProviderFiles(providerId);
            const usedStorage = files.reduce((total, file) => total + (file.file_size || 0), 0);
            const availableAllocated = verifiedStorage - usedStorage;

            await updateProviderStorage(providerId, {
              allocated: verifiedStorage,
              available: availableAllocated,
              last_updated: new Date().toISOString()
            });

            if (usedStorage > 0) {
              console.log(chalk.yellow(`Storage Usage: ${formatStorageSize(usedStorage)} used out of ${formatStorageSize(verifiedStorage)} allocated`));
            }
          } catch (error) {
            console.error(chalk.red('Error monitoring storage:', error.message));
          }
        };

        // Initial storage check
        await monitorStorage();
        // Set up periodic monitoring
        setInterval(monitorStorage, 300000); // Check every 5 minutes

        spinner.succeed('Provider service started successfully');
        console.log(chalk.green('\nProvider is now online and ready to accept storage requests'));
        console.log(chalk.blue(`Provider ID: ${providerId}`));
        console.log(chalk.blue(`Wallet Address: ${walletAddress}`));
        console.log(chalk.blue(`Storage Allocated: ${verifiedStorage}GB`));
        console.log(chalk.blue(`Price per GB: ${answers.price} AAI`));

      } catch (error) {
        spinner.fail('Provider registration failed');
        console.error(chalk.red('Error:', error.message));
        return;
      }

      // Monitor storage and update Supabase
      // Monitor storage and update Supabase
      // Monitor storage and update Supabase
      setInterval(async () => {
        try {
          const files = await getProviderFiles(providerId);
          const usedStorage = files.reduce((total, file) => total + file.file_size, 0);
          const availableAllocated = verifiedStorage - usedStorage;
      
          await updateProviderStorage(providerId, {
            allocated: verifiedStorage,
            available: availableAllocated,
            price: answers.price,
            is_active: true,
            last_updated: new Date().toISOString()
          });
      
          // Only show storage usage when there are actual changes
          if (usedStorage > 0) {
            console.log(chalk.yellow(`Storage Usage Update: ${formatStorageSize(usedStorage)} used out of ${formatStorageSize(verifiedStorage)} allocated`));
          }
      
          console.log(chalk.yellow(`Storage status: ${formatStorageSize(availableAllocated)} available out of ${formatStorageSize(verifiedStorage)} total`));
      } catch (error) {
        console.error(chalk.red('Error updating storage status:', error.message));
      }
      }, 300000); // Check every 5 minutes

      // Display success information
      console.log(chalk.green('\nProvider service started successfully! 🚀'));
      console.log(chalk.yellow(`Allocated Storage: ${answers.storage}GB`));
      console.log(chalk.yellow(`Price per GB: ${answers.price} AAI`));
      console.log(chalk.yellow(`Wallet Address: ${walletAddress}`));
      console.log(chalk.yellow(`Provider ID: ${providerId}`));

      // Start mining rewards and balance checking interval
      const aaiToken = new web3.eth.Contract(AAI_TOKEN_ABI, AAI_TOKEN_ADDRESS);
      setInterval(async () => {
        try {
          // Distribute mining rewards based on storage utilization
          await onlineProviders.get(providerId).contract.methods.distributeMiningRewards()
            .send({ from: walletAddress });
          
          // Check updated balance
          const balance = await aaiToken.methods.balanceOf(walletAddress).call();
          const formattedBalance = web3.utils.fromWei(balance, 'ether');
          console.log(chalk.blue(`Mining rewards claimed! Current AAI Balance: ${formattedBalance} AAI`));
        } catch (error) {
          console.error(chalk.red('Error in mining process:', error.message));
        }
      }, 300000); // Check every 5 minutes

    } catch (ipfsError) {
      spinner.fail('Failed to connect to IPFS node');
      console.error(chalk.red('IPFS Error:', ipfsError.message));
      throw ipfsError;
    }

  } catch (error) {
    spinner.fail('Error starting provider');
    console.error(chalk.red('Error:', error.message));
    if (error.stack) {
      console.error(chalk.red('Stack trace:', error.stack));
    }
  } finally {
    if (provider) {
      provider.engine.stop();
    }
  }
};

import { getActiveProviders } from './supabase.js';

export const getOnlineProviders = async () => {
  try {
    const activeProviders = await getActiveProviders();
    return activeProviders.map(provider => [
      provider.provider_id,
      {
        address: provider.wallet_address,
        storage: provider.allocated_storage,
        price: provider.price_per_gb,
        lastSeen: new Date(provider.last_updated).getTime()
      }
    ]);
  } catch (error) {
    console.error('Error fetching online providers:', error);
    return [];
  }
};

const formatStorageSize = (sizeInGB) => {
  if (sizeInGB < 1) {
    return `${(sizeInGB * 1024).toFixed(2)}MB`;
  }
  return `${sizeInGB.toFixed(2)}GB`;
};

// Function to cleanup provider status when stopping
const cleanupProviderStatus = async (providerId) => {
  try {
    await updateProviderStorage(providerId, {
      is_active: false,
      last_updated: new Date().toISOString()
    });
    onlineProviders.delete(providerId);
    const providers = loadProviders();
    providers.delete(providerId);
    saveProviders(providers);
  } catch (error) {
    console.error(chalk.red('Error cleaning up provider status:', error.message));
  }
};

// Add cleanup handler for process termination
process.on('SIGINT', async () => {
  console.log(chalk.yellow('\nGracefully shutting down...'));
  for (const [providerId] of onlineProviders) {
    await cleanupProviderStatus(providerId);
  }
  process.exit(0);
});