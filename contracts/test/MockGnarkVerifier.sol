// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

contract MockGnarkVerifier {
    bool public result = true;

    function setResult(bool value) external {
        result = value;
    }

    function Verify(bytes calldata, uint256[] calldata) external view returns (bool) {
        return result;
    }
}
