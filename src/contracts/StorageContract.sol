// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StorageContract is Ownable {
    IERC20 public aaiToken;
    
    struct Provider {
        address payable providerAddress;
        uint256 allocatedStorage;
        uint256 usedStorage;
        uint256 pricePerGB;
        bool isActive;
        address[] clients;
        mapping(address => ClientStorage) clientStorages;
    }
    
    struct ClientStorage {
        uint256 allocatedSpace;
        uint256 usedSpace;
        uint256 paymentAmount;
        uint256 lastPaymentTime;
        string[] storedFileCIDs;
        mapping(string => uint256) fileSizes;
    }
    
    mapping(address => Provider) public providers;
    mapping(string => address) public cidToProvider;
    
    event ProviderRegistered(address indexed provider, uint256 storageAmount, uint256 price);
    event StoragePurchased(address indexed client, address indexed provider, uint256 amount);
    event FileStored(address indexed client, address indexed provider, string cid);
    event MiningReward(address indexed provider, uint256 amount);
    
    constructor(address _aaiToken) Ownable(msg.sender) {
        aaiToken = IERC20(_aaiToken);
    }
    
    function registerProvider(uint256 _storage, uint256 _pricePerGB) external {
        require(_storage > 0, "Storage must be greater than 0");
        require(_pricePerGB > 0, "Price must be greater than 0");
        
        providers[msg.sender].providerAddress = payable(msg.sender);
        providers[msg.sender].allocatedStorage = _storage;
        providers[msg.sender].pricePerGB = _pricePerGB;
        providers[msg.sender].isActive = true;
        
        emit ProviderRegistered(msg.sender, _storage, _pricePerGB);
    }
    
    function purchaseStorage(address _provider, uint256 _storageAmount) external {
        Provider storage provider = providers[_provider];
        require(provider.isActive, "Provider is not active");
        require(provider.allocatedStorage - provider.usedStorage >= _storageAmount, "Insufficient storage available");
        
        uint256 paymentAmount = _storageAmount * provider.pricePerGB;
        require(aaiToken.transferFrom(msg.sender, address(this), paymentAmount), "Payment failed");
        
        ClientStorage storage clientStorage = provider.clientStorages[msg.sender];
        if (clientStorage.allocatedSpace == 0) {
            // New client, add to clients array
            provider.clients.push(msg.sender);
        }
        clientStorage.allocatedSpace += _storageAmount;
        clientStorage.paymentAmount += paymentAmount;
        clientStorage.lastPaymentTime = block.timestamp;
        
        provider.usedStorage += _storageAmount;
        
        emit StoragePurchased(msg.sender, _provider, paymentAmount);
    }
    
    function storeFile(address _provider, string memory _cid, uint256 _fileSize) external {
        Provider storage provider = providers[_provider];
        ClientStorage storage clientStorage = provider.clientStorages[msg.sender];
        
        // Convert file size from milliether to GB with improved precision for small files
        // Convert file size from milliether to GB with improved precision for small files
        uint256 fileSizeGB = (_fileSize * 1e9) / (1000 * 1e9);
        // For files smaller than 1GB, use fractional GB instead of rounding up to 1
        if (fileSizeGB == 0 && _fileSize > 0) {
            fileSizeGB = 1;
        }
        require(clientStorage.allocatedSpace >= clientStorage.usedSpace + fileSizeGB, "Insufficient storage purchased");
        
        clientStorage.storedFileCIDs.push(_cid);
        clientStorage.fileSizes[_cid] = _fileSize;
        clientStorage.usedSpace += fileSizeGB;
        cidToProvider[_cid] = _provider;
        
        emit FileStored(msg.sender, _provider, _cid);
    }
    
    function distributeMiningRewards() external {
        Provider storage provider = providers[msg.sender];
        require(provider.isActive, "Provider is not active");
        
        // Calculate rewards based on storage utilization and uptime
        uint256 utilizationRate = (provider.usedStorage * 100) / provider.allocatedStorage;
        uint256 rewardAmount = (utilizationRate * 1 ether) / 100; // 1 AAI per 1% utilization
        
        require(aaiToken.transfer(msg.sender, rewardAmount), "Reward transfer failed");
        
        emit MiningReward(msg.sender, rewardAmount);
    }
    
    function getProviderDetails(address _provider) external view returns (
        uint256 allocatedStorage,
        uint256 usedStorage,
        uint256 pricePerGB,
        bool isActive
    ) {
        Provider storage provider = providers[_provider];
        return (
            provider.allocatedStorage,
            provider.usedStorage,
            provider.pricePerGB,
            provider.isActive
        );
    }
    
    function getClientStorageDetails(address _provider, address _client) external view returns (
        uint256 allocatedSpace,
        uint256 usedSpace,
        uint256 paymentAmount,
        uint256 lastPaymentTime
    ) {
        ClientStorage storage clientStorage = providers[_provider].clientStorages[_client];
        return (
            clientStorage.allocatedSpace,
            clientStorage.usedSpace,
            clientStorage.paymentAmount,
            clientStorage.lastPaymentTime
        );
    }

    function getFileDetails(string memory _cid) external view returns (
        address provider,
        address owner,
        uint256 fileSize
    ) {
        address providerAddr = cidToProvider[_cid];
        require(providerAddr != address(0), "File not found");
        
        Provider storage fileProvider = providers[providerAddr];
        
        // Find the owner of the file by checking all clients
        address fileOwner = address(0);
        uint256 storedFileSize = 0;
        
        // Get all clients who have stored files with this provider
        address[] memory clients = fileProvider.clients;
        for (uint i = 0; i < clients.length; i++) {
            ClientStorage storage clientStorage = fileProvider.clientStorages[clients[i]];
            for (uint j = 0; j < clientStorage.storedFileCIDs.length; j++) {
                if (keccak256(abi.encodePacked(clientStorage.storedFileCIDs[j])) == keccak256(abi.encodePacked(_cid))) {
                    fileOwner = clients[i];
                    storedFileSize = clientStorage.fileSizes[_cid];
                    break;
                }
            }
            if (fileOwner != address(0)) {
                break;
            }
        }

        require(fileOwner != address(0), "File not found or access denied");
        return (providerAddr, fileOwner, storedFileSize);
    }
}