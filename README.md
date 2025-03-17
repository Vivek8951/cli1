# DePIN Storage CLI

A decentralized storage platform built on BSC Testnet that allows users to store and retrieve files using IPFS and blockchain technology.

## Features

- Decentralized file storage using IPFS
- Blockchain-based storage management
- File encryption for security
- Provider and client components
- AAI token integration for payments

## Prerequisites

### Node.js

Ensure you have Node.js version 18 or higher installed. You can download it from [nodejs.org](https://nodejs.org/).

### IPFS

1. Download IPFS Kubo from [dist.ipfs.tech](https://dist.ipfs.tech/#kubo)
2. Extract the archive and add the `ipfs.exe` to your system PATH
3. Open a terminal and verify the installation:
   ```bash
   ipfs --version
   ```
4. Initialize IPFS:
   ```bash
   ipfs init
   ```

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd depin-storage-cli
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on `.env.example` and configure your environment variables:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_KEY=your_supabase_key
   ```

## Usage

### Starting a Storage Provider

1. Start the IPFS daemon in a separate terminal:
   ```bash
   ipfs daemon
   ```

2. Run the provider service:
   ```bash
   npm run start:provider
   ```

3. Follow the prompts to:
   - Enter your BSC wallet private key
   - Specify storage allocation
   - Configure pricing

### Using the Storage Client

1. Ensure IPFS daemon is running

2. Start mining:
   ```bash
   node src/index.js start-mining
   ```

3. Upload a file:
   ```bash
   node src/index.js upload <file-path>
   ```

4. Follow the prompts to:
   - Enter your BSC wallet private key
   - Select a storage provider
   - Purchase storage if needed

### Downloading Files

You can download files using either the DePIN Storage CLI or IPFS CLI directly:

#### Using DePIN Storage CLI
```bash
node src/index.js download <file-cid>
```

#### Using IPFS CLI
```bash
ipfs get <file-cid> -o <output-path>
```

The IPFS CLI method is useful for quick downloads when you don't need to verify ownership or decrypt files.

## Architecture

- **Smart Contracts**: Manages storage allocation, payments, and file tracking
- **IPFS**: Handles decentralized file storage
- **Supabase**: Stores metadata and provider information
- **BSC Testnet**: Processes AAI token payments

## Security

- Files are encrypted using AES-256 before upload
- Private keys are securely stored locally
- Only file owners can access their files

## Development

Run tests:
```bash
npm test
```

## License

MIT