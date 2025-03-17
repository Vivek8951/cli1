// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract AlphaAI is ERC20, Ownable {
    constructor() ERC20("Alpha AI", "AAI") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000_000 * 10**18); // Mint 1 Billion Tokens to the owner
    }

    // Function to mint new tokens (Only owner can call)
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    // Function to burn tokens (Any user can burn their tokens)
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
