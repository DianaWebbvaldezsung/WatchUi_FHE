// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SmartWatchUI is SepoliaConfig {
    struct EncryptedUserProfile {
        address user;
        euint32 encryptedActivityPattern; // Encrypted activity pattern
        euint32 encryptedNotificationPref; // Encrypted notification preferences
        uint256 timestamp;
    }
    
    struct EncryptedUILayout {
        euint32 encryptedLayoutConfig; // Encrypted UI layout configuration
        bool isComputed;
    }
    
    struct DecryptedLayout {
        string layoutData;
        bool isRevealed;
    }

    // Contract state
    mapping(address => EncryptedUserProfile) public userProfiles;
    mapping(address => EncryptedUILayout) public uiLayouts;
    mapping(address => DecryptedLayout) public decryptedLayouts;
    
    // UI component weights
    mapping(string => euint32) private componentWeights;
    string[] private componentList;
    
    // Decryption tracking
    mapping(uint256 => address) private requestToUser;
    
    // Events
    event ProfileUpdated(address indexed user);
    event LayoutComputed(address indexed user);
    event DecryptionRequested(address indexed user);
    event LayoutRevealed(address indexed user);

    /// @notice Initialize UI component weights
    constructor() {
        componentList = ["clock", "notifications", "activity", "weather", "calendar"];
        for (uint i = 0; i < componentList.length; i++) {
            componentWeights[componentList[i]] = FHE.asEuint32(1);
        }
    }

    /// @notice Update user profile
    function updateProfile(
        euint32 encryptedActivityPattern,
        euint32 encryptedNotificationPref
    ) public {
        userProfiles[msg.sender] = EncryptedUserProfile({
            user: msg.sender,
            encryptedActivityPattern: encryptedActivityPattern,
            encryptedNotificationPref: encryptedNotificationPref,
            timestamp: block.timestamp
        });
        
        // Reset UI layout when profile changes
        uiLayouts[msg.sender] = EncryptedUILayout({
            encryptedLayoutConfig: FHE.asEuint32(0),
            isComputed: false
        });
        
        decryptedLayouts[msg.sender] = DecryptedLayout({
            layoutData: "",
            isRevealed: false
        });
        
        emit ProfileUpdated(msg.sender);
    }

    /// @notice Compute personalized UI layout
    function computeUILayout() public {
        require(userProfiles[msg.sender].user != address(0), "No profile");
        require(!uiLayouts[msg.sender].isComputed, "Already computed");
        
        EncryptedUserProfile storage profile = userProfiles[msg.sender];
        
        // Calculate component weights based on user preferences
        euint32 totalWeight = FHE.asEuint32(0);
        for (uint i = 0; i < componentList.length; i++) {
            componentWeights[componentList[i]] = FHE.add(
                componentWeights[componentList[i]],
                FHE.mul(profile.encryptedActivityPattern, FHE.asEuint32(i+1))
            );
            totalWeight = FHE.add(totalWeight, componentWeights[componentList[i]]);
        }
        
        // Normalize weights
        for (uint i = 0; i < componentList.length; i++) {
            componentWeights[componentList[i]] = FHE.div(
                componentWeights[componentList[i]],
                totalWeight
            );
        }
        
        // Generate layout configuration (simplified for demo)
        uiLayouts[msg.sender].encryptedLayoutConfig = FHE.add(
            profile.encryptedActivityPattern,
            profile.encryptedNotificationPref
        );
        uiLayouts[msg.sender].isComputed = true;
        
        emit LayoutComputed(msg.sender);
    }

    /// @notice Request UI layout decryption
    function requestLayoutDecryption() public {
        require(uiLayouts[msg.sender].isComputed, "Layout not computed");
        require(!decryptedLayouts[msg.sender].isRevealed, "Already revealed");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(uiLayouts[msg.sender].encryptedLayoutConfig);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptLayoutCallback.selector);
        requestToUser[reqId] = msg.sender;
        
        emit DecryptionRequested(msg.sender);
    }

    /// @notice Handle layout decryption callback
    function decryptLayoutCallback(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        address user = requestToUser[requestId];
        require(user != address(0), "Invalid request");
        
        DecryptedLayout storage layout = decryptedLayouts[user];
        require(!layout.isRevealed, "Already revealed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 config = abi.decode(cleartexts, (uint32));
        layout.layoutData = generateLayout(config);
        layout.isRevealed = true;
        
        emit LayoutRevealed(user);
    }

    /// @notice Generate UI layout from decrypted config
    function generateLayout(uint32 config) private view returns (string memory) {
        // Simplified layout generation based on config
        string memory layout = "Watch UI Layout:\n";
        for (uint i = 0; i < componentList.length; i++) {
            layout = string(abi.encodePacked(
                layout, 
                componentList[i], 
                ": Priority ", 
                uintToString((config >> (i * 3)) & 7),
                "\n"
            ));
        }
        return layout;
    }

    /// @notice Get encrypted UI layout
    function getEncryptedLayout() public view returns (euint32) {
        require(uiLayouts[msg.sender].isComputed, "Not computed");
        return uiLayouts[msg.sender].encryptedLayoutConfig;
    }

    /// @notice Get decrypted UI layout
    function getDecryptedLayout() public view returns (string memory) {
        require(decryptedLayouts[msg.sender].isRevealed, "Not revealed");
        return decryptedLayouts[msg.sender].layoutData;
    }

    /// @notice Helper to convert uint to string
    function uintToString(uint v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint maxlength = 100;
        bytes memory reversed = new bytes(maxlength);
        uint i = 0;
        while (v != 0) {
            uint remainder = v % 10;
            v = v / 10;
            reversed[i++] = bytes1(uint8(48 + remainder));
        }
        bytes memory s = new bytes(i);
        for (uint j = 0; j < i; j++) {
            s[j] = reversed[i - 1 - j];
        }
        return string(s);
    }
}