// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {GhostClawGnarkIdentityVerifierV2} from "../contracts/generated/GhostClawGnarkIdentityVerifierV2.sol";
import {GhostClawGnarkDepositVerifierV2} from "../contracts/generated/GhostClawGnarkDepositVerifierV2.sol";
import {GhostClawGnarkSpendVerifierV2} from "../contracts/generated/GhostClawGnarkSpendVerifierV2.sol";
import {GhostClawGnarkWithdrawVerifierV2} from "../contracts/generated/GhostClawGnarkWithdrawVerifierV2.sol";

interface VmVerifierV2 {
    function readFile(string calldata path) external returns (string memory);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function parseJsonString(string calldata json, string calldata key) external pure returns (string memory);
    function parseUint(string calldata value) external pure returns (uint256);
}

contract GhostClawGnarkVerifierV2Test {
    VmVerifierV2 private constant VM = VmVerifierV2(address(uint160(uint256(keccak256("hevm cheat code")))));

    GhostClawGnarkIdentityVerifierV2 private identityVerifier;
    GhostClawGnarkDepositVerifierV2 private depositVerifier;
    GhostClawGnarkSpendVerifierV2 private spendVerifier;
    GhostClawGnarkWithdrawVerifierV2 private withdrawVerifier;
    string private fixture;

    function setUp() public {
        fixture = VM.readFile("test/fixtures/v2-local-scenario.json");
        identityVerifier = new GhostClawGnarkIdentityVerifierV2();
        depositVerifier = new GhostClawGnarkDepositVerifierV2();
        spendVerifier = new GhostClawGnarkSpendVerifierV2();
        withdrawVerifier = new GhostClawGnarkWithdrawVerifierV2();
    }

    function testIdentityProofUsesTheGeneratedVerifier() public view {
        assert(
            identityVerifier.Verify(
                _bytes(".identities.payer.proof.proof"), _inputs(".identities.payer.proof.publicInputs", 3)
            )
        );
    }

    function testDepositProofUsesTheGeneratedVerifier() public view {
        assert(depositVerifier.Verify(_bytes(".deposit.proof.proof"), _inputs(".deposit.proof.publicInputs", 4)));
    }

    function testSpendProofUsesTheGeneratedVerifier() public view {
        assert(spendVerifier.Verify(_bytes(".payment.proof.proof"), _inputs(".payment.proof.publicInputs", 10)));
    }

    function testWithdrawProofUsesTheGeneratedVerifier() public view {
        assert(withdrawVerifier.Verify(_bytes(".withdraw.proof.proof"), _inputs(".withdraw.proof.publicInputs", 7)));
    }

    function testChangedPublicInputIsRejected() public view {
        uint256[] memory inputs = _inputs(".payment.proof.publicInputs", 10);
        inputs[7] += 1;
        assert(!spendVerifier.Verify(_bytes(".payment.proof.proof"), inputs));
    }

    function _bytes(string memory path) private view returns (bytes memory) {
        return VM.parseJsonBytes(fixture, path);
    }

    function _inputs(string memory path, uint256 count) private view returns (uint256[] memory inputs) {
        inputs = new uint256[](count);
        for (uint256 index; index < count; ++index) {
            string memory indexedPath = string.concat(path, "[", _decimal(index), "]");
            inputs[index] = VM.parseUint(VM.parseJsonString(fixture, indexedPath));
        }
    }

    function _decimal(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";
        uint256 digits;
        uint256 cursor = value;
        while (cursor != 0) {
            ++digits;
            cursor /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            --digits;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
