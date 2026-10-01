// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {GhostClawGnarkPlonkPoolV2} from "../contracts/GhostClawGnarkPlonkPoolV2.sol";
import {GhostClawPoseidon2BN254} from "../contracts/generated/GhostClawPoseidon2BN254.sol";
import {MockGnarkVerifier} from "../contracts/test/MockGnarkVerifier.sol";
import {MockGUSD} from "../contracts/test/MockGUSD.sol";

interface VmV2 {
    function addr(uint256 privateKey) external returns (address);
    function chainId(uint256 newChainId) external;
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
}

contract GhostClawGnarkPlonkPoolV2Harness is GhostClawGnarkPlonkPoolV2 {
    constructor(address tokenAddress, address verifierAddress, address poseidon2Address)
        GhostClawGnarkPlonkPoolV2(
            tokenAddress, verifierAddress, verifierAddress, verifierAddress, verifierAddress, poseidon2Address
        )
    {}

    function rememberRootForTest(uint256 root) external {
        _rememberRoot(root);
    }
}

contract AdversarialTokenV2 {
    enum Mode {
        Standard,
        FalseReturn,
        InboundFee,
        Reenter
    }

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;
    Mode public mode;
    address public reentryTarget;
    bool public reentryAttempted;
    bool public reentryBlocked;

    function mint(address recipient, uint256 amount) external {
        balanceOf[recipient] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function setMode(Mode newMode, address target) external {
        mode = newMode;
        reentryTarget = target;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (mode == Mode.FalseReturn) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        if (mode == Mode.FalseReturn) return false;
        if (mode == Mode.Reenter) {
            reentryAttempted = true;
            (bool success, bytes memory result) = reentryTarget.call(
                abi.encodeCall(GhostClawGnarkPlonkPoolV2.deposit, (bytes("proof"), uint256(999), uint64(1)))
            );
            bytes4 selector;
            if (result.length >= 4) {
                assembly {
                    selector := mload(add(result, 32))
                }
            }
            reentryBlocked = !success && selector == GhostClawGnarkPlonkPoolV2.ReentrantCall.selector;
        }
        uint256 approved = allowance[sender][msg.sender];
        if (approved != type(uint256).max) allowance[sender][msg.sender] = approved - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += mode == Mode.InboundFee ? amount - 1 : amount;
        return true;
    }
}

contract GhostClawGnarkPlonkPoolV2Test {
    VmV2 private constant VM = VmV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant PAYER_KEY = 0xA11CE;
    uint256 private constant MERCHANT_KEY = 0xB0B;
    uint256 private constant ROTATED_KEY = 0xCAFE;
    uint256 private constant RECOVERY_KEY = 0xD00D;
    uint256 private constant PAYER_OWNER = 1001;
    uint256 private constant MERCHANT_OWNER = 1002;

    GhostClawGnarkPlonkPoolV2 private pool;
    GhostClawPoseidon2BN254 private hasher;
    MockGnarkVerifier private verifier;
    MockGUSD private token;
    address private payer;
    address private merchant;

    function setUp() public {
        VM.chainId(84532);
        payer = VM.addr(PAYER_KEY);
        merchant = VM.addr(MERCHANT_KEY);
        verifier = new MockGnarkVerifier();
        hasher = new GhostClawPoseidon2BN254();
        token = new MockGUSD();
        pool = new GhostClawGnarkPlonkPoolV2(
            address(token), address(verifier), address(verifier), address(verifier), address(verifier), address(hasher)
        );
        VM.prank(payer);
        pool.registerSelf("proof", PAYER_OWNER);
        VM.prank(merchant);
        pool.registerSelf("proof", MERCHANT_OWNER);
        token.mint(payer, 100_000_000);
        VM.prank(payer);
        token.approve(address(pool), type(uint256).max);
    }

    function testAppendsPairsAndKeepsHistoricalRoots() public {
        uint256 depositCommitment = 111;
        VM.prank(payer);
        pool.deposit("proof", depositCommitment, 100_000_000);
        uint256 depositRoot = pool.currentRoot();
        assert(depositRoot == _rootAfterPair(depositCommitment, 0));
        assert(pool.roots(depositRoot));
        assert(pool.nextLeafIndex() == 2);

        VM.prank(payer);
        pool.confidentialTransfer("proof", depositRoot, 222, 333, 444, MERCHANT_OWNER, 555, merchant);
        assert(pool.roots(depositRoot));
        assert(pool.roots(pool.currentRoot()));
        assert(pool.commitments(333));
        assert(pool.commitments(444));
        assert(pool.nextLeafIndex() == 4);
    }

    function testVerifierFailureStopsStateChange() public {
        verifier.setResult(false);
        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.InvalidProof.selector);
        pool.deposit("changed", 111, 100_000_000);
        assert(token.balanceOf(address(pool)) == 0);
        assert(pool.nextLeafIndex() == 0);
    }

    function testRejectsDuplicateAndOutOfFieldCommitments() public {
        VM.prank(payer);
        pool.deposit("proof", 111, 100_000_000);
        uint256 spendRoot = pool.currentRoot();

        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.DuplicateCommitment.selector);
        pool.deposit("proof", 111, 1);

        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.DuplicateCommitment.selector);
        pool.confidentialTransfer("proof", spendRoot, 222, 333, 333, MERCHANT_OWNER, 555, merchant);

        uint256 scalarField = pool.BN254_SCALAR_FIELD();
        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.InvalidFieldElement.selector);
        pool.confidentialTransfer("proof", spendRoot, 222, scalarField, 444, MERCHANT_OWNER, 555, merchant);
    }

    function testNullifierAndPaymentIntentCannotReplay() public {
        VM.prank(payer);
        pool.deposit("proof", 111, 100_000_000);
        uint256 spendRoot = pool.currentRoot();
        VM.prank(payer);
        pool.confidentialTransfer("proof", spendRoot, 222, 333, 444, MERCHANT_OWNER, 555, merchant);

        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.NullifierAlreadySpent.selector);
        pool.confidentialTransfer("proof", spendRoot, 222, 666, 777, MERCHANT_OWNER, 888, merchant);

        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.PaymentIntentAlreadySettled.selector);
        pool.confidentialTransfer("proof", spendRoot, 999, 666, 777, MERCHANT_OWNER, 555, merchant);
    }

    function testImmediateRotationRequiresNewAccountConsent() public {
        address rotated = VM.addr(ROTATED_KEY);
        uint256 nonce = pool.identityNonce(PAYER_OWNER);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory consent =
            _consent(ROTATED_KEY, PAYER_OWNER, payer, rotated, pool.IDENTITY_ACTION_ROTATE(), nonce, deadline);
        VM.prank(payer);
        pool.rotateAccount("proof", rotated, deadline, consent);
        assert(pool.ownerOf(payer) == 0);
        assert(pool.ownerOf(rotated) == PAYER_OWNER);
        assert(pool.accountForOwner(PAYER_OWNER) == rotated);
        assert(pool.identityNonce(PAYER_OWNER) == nonce + 1);
    }

    function testRegistrationRejectsOwnerAndAccountRaces() public {
        address racingAccount = VM.addr(0xF00D);
        VM.prank(racingAccount);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.OwnerAlreadyRegistered.selector);
        pool.registerSelf("proof", PAYER_OWNER);

        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.IdentityAlreadyRegistered.selector);
        pool.registerSelf("proof", 1_999);
    }

    function testExpiredRotationAndRecoveryConsentAreRejected() public {
        address rotated = VM.addr(ROTATED_KEY);
        uint256 nonce = pool.identityNonce(PAYER_OWNER);
        uint256 deadline = block.timestamp + 10;
        bytes memory rotation =
            _consent(ROTATED_KEY, PAYER_OWNER, payer, rotated, pool.IDENTITY_ACTION_ROTATE(), nonce, deadline);
        VM.warp(deadline + 1);
        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.SignatureExpired.selector);
        pool.rotateAccount("proof", rotated, deadline, rotation);

        address recovered = VM.addr(RECOVERY_KEY);
        bytes memory recovery =
            _consent(RECOVERY_KEY, PAYER_OWNER, payer, recovered, pool.IDENTITY_ACTION_RECOVER(), nonce, deadline);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.SignatureExpired.selector);
        pool.requestRecovery("proof", PAYER_OWNER, recovered, deadline, recovery);
    }

    function testCancelledRecoveryConsentCannotBeReplayed() public {
        address recovered = VM.addr(RECOVERY_KEY);
        uint256 nonce = pool.identityNonce(PAYER_OWNER);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory consent =
            _consent(RECOVERY_KEY, PAYER_OWNER, payer, recovered, pool.IDENTITY_ACTION_RECOVER(), nonce, deadline);
        pool.requestRecovery("proof", PAYER_OWNER, recovered, deadline, consent);
        VM.prank(payer);
        pool.cancelRecovery(PAYER_OWNER);

        VM.expectRevert(GhostClawGnarkPlonkPoolV2.InvalidSignature.selector);
        pool.requestRecovery("proof", PAYER_OWNER, recovered, deadline, consent);
    }

    function testDelayedRecoveryCanBeCancelledAndFinalized() public {
        address recovered = VM.addr(RECOVERY_KEY);
        uint256 deadline = block.timestamp + 1 hours;
        uint256 nonce = pool.identityNonce(PAYER_OWNER);
        bytes memory consent =
            _consent(RECOVERY_KEY, PAYER_OWNER, payer, recovered, pool.IDENTITY_ACTION_RECOVER(), nonce, deadline);
        pool.requestRecovery("proof", PAYER_OWNER, recovered, deadline, consent);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.RecoveryDelayActive.selector);
        pool.finalizeRecovery(PAYER_OWNER);

        VM.prank(payer);
        pool.cancelRecovery(PAYER_OWNER);
        (, address pendingAccount,,) = pool.pendingRecovery(PAYER_OWNER);
        assert(pendingAccount == address(0));

        nonce = pool.identityNonce(PAYER_OWNER);
        deadline = block.timestamp + 1 hours;
        consent = _consent(RECOVERY_KEY, PAYER_OWNER, payer, recovered, pool.IDENTITY_ACTION_RECOVER(), nonce, deadline);
        pool.requestRecovery("proof", PAYER_OWNER, recovered, deadline, consent);
        VM.warp(block.timestamp + pool.RECOVERY_DELAY());
        pool.finalizeRecovery(PAYER_OWNER);
        assert(pool.ownerOf(payer) == 0);
        assert(pool.ownerOf(recovered) == PAYER_OWNER);
    }

    function testWithdrawalPreservesEscrowInvariant() public {
        VM.prank(payer);
        pool.deposit("proof", 111, 100_000_000);
        uint256 spendRoot = pool.currentRoot();
        VM.prank(payer);
        pool.withdraw("proof", spendRoot, 222, 333, payer, 10_000_000);
        assert(pool.totalEscrowed() == 90_000_000);
        assert(token.balanceOf(address(pool)) == 90_000_000);
        assert(token.balanceOf(payer) == 10_000_000);
    }

    function testFullWithdrawalUsesTheZeroDummyLeaf() public {
        VM.prank(payer);
        pool.deposit("proof", 111, 100_000_000);
        uint256 spendRoot = pool.currentRoot();
        VM.prank(payer);
        pool.withdraw("proof", spendRoot, 222, 0, payer, 100_000_000);
        assert(pool.totalEscrowed() == 0);
        assert(token.balanceOf(address(pool)) == 0);
        assert(token.balanceOf(payer) == 100_000_000);
        assert(!pool.commitments(0));
        assert(pool.nextLeafIndex() == 4);
    }

    function testHistoricalRootExpiresAfterTheConfiguredWindow() public {
        GhostClawGnarkPlonkPoolV2Harness harness =
            new GhostClawGnarkPlonkPoolV2Harness(address(token), address(verifier), address(hasher));
        uint256 initialRoot = harness.currentRoot();
        for (uint256 index; index < harness.ROOT_HISTORY_SIZE(); ++index) {
            harness.rememberRootForTest(10_000 + index);
        }
        assert(!harness.roots(initialRoot));
        assert(harness.roots(10_000));
        harness.rememberRootForTest(20_000);
        assert(!harness.roots(10_000));
        assert(harness.roots(20_000));
    }

    function testRejectsFalseReturnAndFeeTokens() public {
        AdversarialTokenV2 falseToken = new AdversarialTokenV2();
        GhostClawGnarkPlonkPoolV2 falsePool = _newPool(address(falseToken));
        _registerAndApprove(falsePool, falseToken);
        falseToken.setMode(AdversarialTokenV2.Mode.FalseReturn, address(0));
        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.TokenTransferFailed.selector);
        falsePool.deposit("proof", 7001, 100_000_000);
        assert(falsePool.totalEscrowed() == 0);

        AdversarialTokenV2 feeToken = new AdversarialTokenV2();
        GhostClawGnarkPlonkPoolV2 feePool = _newPool(address(feeToken));
        _registerAndApprove(feePool, feeToken);
        feeToken.setMode(AdversarialTokenV2.Mode.InboundFee, address(0));
        VM.prank(payer);
        VM.expectRevert(GhostClawGnarkPlonkPoolV2.UnsupportedToken.selector);
        feePool.deposit("proof", 7002, 100_000_000);
        assert(feePool.totalEscrowed() == 0);
        assert(feeToken.balanceOf(address(feePool)) == 0);
    }

    function testTokenCallbackCannotReenterThePool() public {
        AdversarialTokenV2 callbackToken = new AdversarialTokenV2();
        GhostClawGnarkPlonkPoolV2 callbackPool = _newPool(address(callbackToken));
        _registerAndApprove(callbackPool, callbackToken);
        callbackToken.setMode(AdversarialTokenV2.Mode.Reenter, address(callbackPool));
        VM.prank(payer);
        callbackPool.deposit("proof", 7003, 100_000_000);
        assert(callbackToken.reentryAttempted());
        assert(callbackToken.reentryBlocked());
        assert(!callbackPool.commitments(999));
        assert(callbackPool.totalEscrowed() == 100_000_000);
    }

    function _rootAfterPair(uint256 left, uint256 right) private view returns (uint256 root) {
        root = hasher.hashPair(left, right);
        for (uint256 level = 1; level < pool.TREE_DEPTH(); ++level) {
            root = hasher.hashPair(root, pool.zeroes(level));
        }
    }

    function _newPool(address tokenAddress) private returns (GhostClawGnarkPlonkPoolV2) {
        return new GhostClawGnarkPlonkPoolV2(
            tokenAddress, address(verifier), address(verifier), address(verifier), address(verifier), address(hasher)
        );
    }

    function _registerAndApprove(GhostClawGnarkPlonkPoolV2 target, AdversarialTokenV2 targetToken) private {
        VM.prank(payer);
        target.registerSelf("proof", PAYER_OWNER + uint256(uint160(address(target))));
        targetToken.mint(payer, 100_000_000);
        VM.prank(payer);
        targetToken.approve(address(target), type(uint256).max);
    }

    function _consent(
        uint256 privateKey,
        uint256 owner,
        address currentAccount,
        address newAccount,
        uint256 action,
        uint256 nonce,
        uint256 deadline
    ) private returns (bytes memory) {
        bytes32 consent = pool.accountConsentDigest(owner, currentAccount, newAccount, action, nonce, deadline);
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", consent));
        (uint8 v, bytes32 r, bytes32 s) = VM.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
