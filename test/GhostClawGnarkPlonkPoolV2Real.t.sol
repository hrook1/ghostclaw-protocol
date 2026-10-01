// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {GhostClawGnarkPlonkPoolV2} from "../contracts/GhostClawGnarkPlonkPoolV2.sol";
import {GhostClawGnarkIdentityVerifierV2} from "../contracts/generated/GhostClawGnarkIdentityVerifierV2.sol";
import {GhostClawGnarkDepositVerifierV2} from "../contracts/generated/GhostClawGnarkDepositVerifierV2.sol";
import {GhostClawGnarkSpendVerifierV2} from "../contracts/generated/GhostClawGnarkSpendVerifierV2.sol";
import {GhostClawGnarkWithdrawVerifierV2} from "../contracts/generated/GhostClawGnarkWithdrawVerifierV2.sol";
import {GhostClawPoseidon2BN254} from "../contracts/generated/GhostClawPoseidon2BN254.sol";
import {MockGUSD} from "../contracts/test/MockGUSD.sol";

interface VmV2Real {
    function chainId(uint256 newChainId) external;
    function etch(address target, bytes calldata code) external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function readFile(string calldata path) external returns (string memory);
    function parseJsonAddress(string calldata json, string calldata key) external pure returns (address);
    function parseJsonBytes(string calldata json, string calldata key) external pure returns (bytes memory);
    function parseJsonString(string calldata json, string calldata key) external pure returns (string memory);
    function parseUint(string calldata value) external pure returns (uint256);
}

contract GhostClawV2EtchedHarness is GhostClawGnarkPlonkPoolV2 {
    constructor(
        address tokenAddress,
        address identityVerifierAddress,
        address depositVerifierAddress,
        address spendVerifierAddress,
        address withdrawVerifierAddress,
        address poseidon2Address
    )
        GhostClawGnarkPlonkPoolV2(
            tokenAddress,
            identityVerifierAddress,
            depositVerifierAddress,
            spendVerifierAddress,
            withdrawVerifierAddress,
            poseidon2Address
        )
    {}

    function initializeEtchedTree() external {
        assert(currentRoot == 0 && rootCursor == 0 && nextLeafIndex == 0);
        zeroes[0] = 0;
        for (uint256 level = 1; level <= TREE_DEPTH; ++level) {
            zeroes[level] = poseidon2.hashPair(zeroes[level - 1], zeroes[level - 1]);
        }
        _rememberRoot(zeroes[TREE_DEPTH]);
    }
}

contract GhostClawGnarkPlonkPoolV2RealTest {
    VmV2Real private constant VM = VmV2Real(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CONTEXT = 0x1111111111111111111111111111111111111111;

    GhostClawV2EtchedHarness private pool;
    MockGUSD private token;
    string private fixture;
    address private payer;
    address private merchant;

    event GasMeasured(string action, uint256 gasUsed);

    function setUp() public {
        VM.chainId(84532);
        fixture = VM.readFile("test/fixtures/v2-local-scenario.json");
        payer = VM.parseJsonAddress(fixture, ".payer");
        merchant = VM.parseJsonAddress(fixture, ".merchant");

        token = new MockGUSD();
        GhostClawGnarkIdentityVerifierV2 identityVerifier = new GhostClawGnarkIdentityVerifierV2();
        GhostClawGnarkDepositVerifierV2 depositVerifier = new GhostClawGnarkDepositVerifierV2();
        GhostClawGnarkSpendVerifierV2 spendVerifier = new GhostClawGnarkSpendVerifierV2();
        GhostClawGnarkWithdrawVerifierV2 withdrawVerifier = new GhostClawGnarkWithdrawVerifierV2();
        GhostClawPoseidon2BN254 poseidon2 = new GhostClawPoseidon2BN254();
        GhostClawV2EtchedHarness implementation = new GhostClawV2EtchedHarness(
            address(token),
            address(identityVerifier),
            address(depositVerifier),
            address(spendVerifier),
            address(withdrawVerifier),
            address(poseidon2)
        );
        VM.etch(CONTEXT, address(implementation).code);
        pool = GhostClawV2EtchedHarness(CONTEXT);
        pool.initializeEtchedTree();

        VM.prank(payer);
        pool.registerSelf(_bytes(".identities.payer.proof.proof"), _uint(".owners.payer"));
        VM.prank(merchant);
        pool.registerSelf(_bytes(".identities.merchant.proof.proof"), _uint(".owners.merchant"));

        token.mint(payer, _uint(".deposit.amount"));
        VM.prank(payer);
        token.approve(address(pool), type(uint256).max);
    }

    function testRealVerifierEndToEndDepositPaymentWithdrawal() public {
        uint256 gasBefore = gasleft();
        VM.prank(payer);
        pool.deposit(_bytes(".deposit.proof.proof"), _uint(".deposit.commitment"), uint64(_uint(".deposit.amount")));
        emit GasMeasured("deposit", gasBefore - gasleft());
        assert(pool.currentRoot() == _uint(".payment.spendRoot"));
        assert(pool.totalEscrowed() == 100_000_000);

        gasBefore = gasleft();
        VM.prank(payer);
        pool.confidentialTransfer(
            _bytes(".payment.proof.proof"),
            _uint(".payment.spendRoot"),
            _uint(".payment.nullifier"),
            _uint(".payment.outputLeft"),
            _uint(".payment.outputRight"),
            _uint(".payment.recipientOwner"),
            _uint(".payment.paymentIntent"),
            merchant
        );
        emit GasMeasured("payment", gasBefore - gasleft());
        assert(pool.currentRoot() == _uint(".withdraw.spendRoot"));
        assert(pool.nullifiers(_uint(".payment.nullifier")));
        assert(pool.settledPaymentIntents(_uint(".payment.paymentIntent")));

        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.InvalidProof.selector);
        pool.withdraw(
            _bytes(".withdraw.proof.proof"),
            _uint(".withdraw.spendRoot"),
            _uint(".withdraw.nullifier"),
            _uint(".withdraw.changeCommitment"),
            merchant,
            uint64(_uint(".withdraw.amount"))
        );

        gasBefore = gasleft();
        VM.prank(payer);
        pool.withdraw(
            _bytes(".withdraw.proof.proof"),
            _uint(".withdraw.spendRoot"),
            _uint(".withdraw.nullifier"),
            _uint(".withdraw.changeCommitment"),
            payer,
            uint64(_uint(".withdraw.amount"))
        );
        emit GasMeasured("withdrawal", gasBefore - gasleft());
        assert(pool.nullifiers(_uint(".withdraw.nullifier")));
        assert(pool.totalEscrowed() == 90_000_000);
        assert(token.balanceOf(payer) == 10_000_000);
        assert(token.balanceOf(address(pool)) == 90_000_000);
    }

    function _bytes(string memory path) private view returns (bytes memory) {
        return VM.parseJsonBytes(fixture, path);
    }

    function _uint(string memory path) private view returns (uint256) {
        return VM.parseUint(VM.parseJsonString(fixture, path));
    }
}
