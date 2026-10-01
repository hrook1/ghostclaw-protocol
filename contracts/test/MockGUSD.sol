// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract MockGUSD {
    string public constant name = "Ghost USD";
    string public constant symbol = "gUSD";
    uint8 public constant decimals = 6;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[sender][msg.sender];
        if (allowed != type(uint256).max) allowance[sender][msg.sender] = allowed - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}
