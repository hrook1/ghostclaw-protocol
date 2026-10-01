// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Valueless Base Sepolia token for the GhostClaw v2 public demo.
contract GhostClawTestUSDV2 {
    string public constant name = "GhostClaw Test USD";
    string public constant symbol = "gUSD";
    uint8 public constant decimals = 6;
    uint256 public constant FAUCET_AMOUNT = 100_000_000;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    mapping(address account => bool used) public faucetUsed;

    uint256 public totalSupply;

    error FaucetAlreadyUsed();
    error InvalidRecipient();
    error InsufficientBalance();
    error InsufficientAllowance();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);

    function faucet() external {
        if (faucetUsed[msg.sender]) revert FaucetAlreadyUsed();
        faucetUsed[msg.sender] = true;
        totalSupply += FAUCET_AMOUNT;
        balanceOf[msg.sender] += FAUCET_AMOUNT;
        emit Transfer(address(0), msg.sender, FAUCET_AMOUNT);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (spender == address(0)) revert InvalidRecipient();
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        _transfer(msg.sender, recipient, amount);
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 approved = allowance[sender][msg.sender];
        if (approved != type(uint256).max) {
            if (approved < amount) revert InsufficientAllowance();
            allowance[sender][msg.sender] = approved - amount;
            emit Approval(sender, msg.sender, approved - amount);
        }
        _transfer(sender, recipient, amount);
        return true;
    }

    function _transfer(address sender, address recipient, uint256 amount) private {
        if (recipient == address(0)) revert InvalidRecipient();
        uint256 balance = balanceOf[sender];
        if (balance < amount) revert InsufficientBalance();
        balanceOf[sender] = balance - amount;
        balanceOf[recipient] += amount;
        emit Transfer(sender, recipient, amount);
    }
}
