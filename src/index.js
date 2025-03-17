import { Command } from 'commander';
import figlet from 'figlet';
import chalk from 'chalk';
import * as dotenv from 'dotenv';
import { startProvider } from './provider.js';
import { startClient } from './client.js';
import { downloadFile } from './download.js';

// Load environment variables from .env file
dotenv.config();

// Add error handling for unhandled promise rejections
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled promise rejection:', error));
  process.exit(1);
});

const program = new Command();

console.clear(); // Clear the console before displaying the banner
console.log(chalk.blue(figlet.textSync('DePIN Storage')));

program
  .version('1.0.0')
  .description('DePIN-based decentralized cloud storage system');

program
  .command('start-mining')
  .description('Start provider mining mode')
  .action(async () => {
    try {
      await startProvider();
    } catch (error) {
      console.error(chalk.red('Error starting provider:', error.message));
      process.exit(1);
    }
  });

program
  .command('upload')
  .description('Upload a file as a client')
  .action(async () => {
    try {
      await startClient();
    } catch (error) {
      console.error(chalk.red('Error starting client:', error.message));
      process.exit(1);
    }
  });

program
  .command('download')
  .description('Download a file from storage')
  .action(async () => {
    try {
      await downloadFile();
    } catch (error) {
      console.error(chalk.red('Error downloading file:', error.message));
      process.exit(1);
    }
  });

program.parse(process.argv);

// Show help if no arguments provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}