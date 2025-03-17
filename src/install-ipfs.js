import os from 'os';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

console.log('IPFS Installer Script - Starting...');

console.log('All modules imported successfully');

class IPFSInstaller {
    constructor() {
        console.log('Initializing IPFS Installer...');
        console.log('Platform:', os.platform());
        console.log('Architecture:', os.arch());
        console.log('Home Directory:', os.homedir());
        
        this.platform = os.platform();
        this.arch = os.arch();
        this.homeDir = os.homedir();
        this.ipfsPath = this.getIPFSPath();
        
        console.log('IPFS Installation Path:', this.ipfsPath);
    }

    getIPFSPath() {
        switch (this.platform) {
            case 'win32':
                return path.join(this.homeDir, '.ipfs', 'ipfs.exe');
            default:
                return path.join('/usr/local/bin', 'ipfs');
        }
    }

    async isIPFSInstalled() {
        try {
            console.log('Checking if IPFS is already installed...');
            const result = await execAsync('ipfs --version');
            console.log('IPFS version check result:', result.stdout);
            return true;
        } catch (error) {
            console.log('IPFS is not installed:', error.message);
            return false;
        }
    }

    async initializeIPFS() {
        try {
            console.log('Initializing IPFS daemon...');
            const result = await execAsync('ipfs init');
            console.log('IPFS initialization output:', result.stdout);
            console.log('IPFS initialized successfully!');
        } catch (error) {
            if (!error.message.includes('already initialized')) {
                console.error('Error initializing IPFS:', error.message);
                throw error;
            } else {
                console.log('IPFS is already initialized');
            }
        }
    }

    getDownloadUrl() {
        const version = 'v0.22.0';
        let osType, arch;

        switch (this.platform) {
            case 'win32':
                osType = 'windows';
                break;
            case 'darwin':
                osType = 'darwin';
                break;
            default:
                osType = 'linux';
        }

        arch = this.arch === 'x64' ? 'amd64' : this.arch;
        return `https://dist.ipfs.tech/kubo/${version}/kubo_${version}_${osType}-${arch}.tar.gz`;
    }

    async downloadIPFS() {
        const url = this.getDownloadUrl();
        const downloadPath = path.join(os.tmpdir(), 'ipfs.tar.gz');

        console.log('Starting IPFS download from:', url);
        console.log('This may take a few minutes depending on your internet connection...');
        
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(downloadPath);
            const request = https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    fs.unlink(downloadPath, () => {});
                    reject(new Error(`Failed to download IPFS. Server responded with status code: ${response.statusCode}`));
                    return;
                }

                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;
                
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    const progress = (downloadedSize / totalSize * 100).toFixed(2);
                    process.stdout.write(`\rDownloading IPFS: ${progress}% complete`);
                });

                response.pipe(file);
                file.on('finish', () => {
                    process.stdout.write('\n');
                    console.log('Download completed successfully!');
                    file.close();
                    resolve(downloadPath);
                });
            });

            request.on('error', (err) => {
                console.error('\nNetwork error during download:', err.message);
                fs.unlink(downloadPath, () => {});
                reject(new Error(`Failed to download IPFS: ${err.message}`));
            });

            request.setTimeout(30000, () => {
                request.destroy();
                fs.unlink(downloadPath, () => {});
                reject(new Error('Download timed out after 30 seconds'));
            });
        });
    }

    async extractAndInstall(downloadPath) {
        const extractDir = path.join(os.tmpdir(), 'ipfs-extract');
        console.log('\nStarting IPFS extraction process...');
        console.log('Extraction directory:', extractDir);

        try {
            // Create extract directory
            if (!fs.existsSync(extractDir)) {
                console.log('Creating extraction directory...');
                fs.mkdirSync(extractDir, { recursive: true });
            }

            // Extract the archive
            console.log('Extracting IPFS archive...');
            if (this.platform === 'win32') {
                await execAsync(`tar -xzf "${downloadPath}" -C "${extractDir}"`);
            } else {
                await execAsync(`tar xzf "${downloadPath}" -C "${extractDir}"`);
            }
            console.log('Archive extracted successfully!');

            // Find the ipfs binary in the extracted files
            const ipfsBinary = this.platform === 'win32' ? 'ipfs.exe' : 'ipfs';
            const extractedBinary = path.join(extractDir, 'kubo', ipfsBinary);
            console.log('Locating IPFS binary:', ipfsBinary);

            // Create destination directory if it doesn't exist
            const destDir = path.dirname(this.ipfsPath);
            if (!fs.existsSync(destDir)) {
                console.log('Creating IPFS installation directory...');
                fs.mkdirSync(destDir, { recursive: true });
            }

            // Copy the binary to the destination
            console.log('Installing IPFS binary to:', this.ipfsPath);
            fs.copyFileSync(extractedBinary, this.ipfsPath);
            fs.chmodSync(this.ipfsPath, 0o755);
            console.log('IPFS binary installed successfully!');

            // Clean up
            console.log('Cleaning up temporary files...');
            fs.rmSync(extractDir, { recursive: true, force: true });
            fs.unlinkSync(downloadPath);
            console.log('Cleanup completed!');

            console.log('IPFS installation process completed successfully!');
        } catch (error) {
            console.error('\nError during IPFS extraction and installation:', error.message);
            if (error.stderr) console.error('Additional error details:', error.stderr);
            throw error;
        }
    }

    async updatePath() {
        const binDir = path.dirname(this.ipfsPath);

        if (this.platform === 'win32') {
            // Update Windows PATH
            const userPath = await execAsync('echo %PATH%');
            if (!userPath.stdout.includes(binDir)) {
                await execAsync(`setx PATH "%PATH%;${binDir}"`);
            }
        } else {
            // Update Unix-like PATH
            const shellConfigFile = path.join(this.homeDir, this.platform === 'darwin' ? '.zshrc' : '.bashrc');
            const pathLine = `\nexport PATH="$PATH:${binDir}"\n`;

            if (!fs.existsSync(shellConfigFile) || !fs.readFileSync(shellConfigFile, 'utf8').includes(binDir)) {
                fs.appendFileSync(shellConfigFile, pathLine);
            }
        }

        console.log('PATH updated successfully!');
    }

    async initializeIPFS() {
        try {
            await execAsync('ipfs init');
            console.log('IPFS initialized successfully!');
        } catch (error) {
            if (!error.message.includes('already initialized')) {
                throw error;
            }
        }
    }

    async install() {
        try {
            console.log('Starting IPFS installation process...');
            const isInstalled = await this.isIPFSInstalled();
            if (isInstalled) {
                console.log('IPFS is already installed and available in PATH!');
                return;
            }

            console.log('IPFS not found. Starting fresh installation...');
            const downloadPath = await this.downloadIPFS();
            await this.extractAndInstall(downloadPath);
            console.log('Updating system PATH...');
            await this.updatePath();
            console.log('Initializing IPFS...');
            await this.initializeIPFS();

            console.log('\nIPFS installation completed successfully!');
            console.log('You can now use IPFS commands in your terminal.');
        } catch (error) {
            console.error('\nError during IPFS installation:', error.message);
            throw error;
        }
    }
}

// Export the installer class
export default IPFSInstaller;

// If running directly, execute the installation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log('Starting IPFS installer script...');
    (async () => {
        try {
            const installer = new IPFSInstaller();
            await installer.install();
        } catch (error) {
            console.error('Failed to initialize IPFS installer:', error);
            process.exit(1);
        }
    })();
}