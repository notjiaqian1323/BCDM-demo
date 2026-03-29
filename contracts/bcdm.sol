// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract WorkspaceACL {
    address public serverAdmin;

    // Mapping: WorkspaceID => (UserID => Has Access?)
    mapping(string => mapping(string => bool)) private accessList;

    event AccessGranted(string workspaceId, string userId, uint256 timestamp);
    event AccessRevoked(string workspaceId, string userId, uint256 timestamp);

    constructor() {
        serverAdmin = msg.sender; // The wallet that deploys this is the admin
    }

    modifier onlyAdmin() {
        require(msg.sender == serverAdmin, "Only the server can modify access");
        _;
    }

    // Grant a user access to a workspace
    function grantAccess(string memory workspaceId, string memory userId) public onlyAdmin {
        accessList[workspaceId][userId] = true;
        emit AccessGranted(workspaceId, userId, block.timestamp);
    }

    // Revoke a user's access
    function revokeAccess(string memory workspaceId, string memory userId) public onlyAdmin {
        accessList[workspaceId][userId] = false;
        emit AccessRevoked(workspaceId, userId, block.timestamp);
    }

    // Check if a user has access (Can be called for free)
    function checkAccess(string memory workspaceId, string memory userId) public view returns (bool) {
        return accessList[workspaceId][userId];
    }
}