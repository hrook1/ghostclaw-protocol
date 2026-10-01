// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IGhostClawGnarkVerifierV2 {
    function Verify(bytes calldata proof, uint256[] calldata publicInputs) external view returns (bool);
}

interface IGhostClawPoseidon2V2 {
    function hashPair(uint256 left, uint256 right) external pure returns (uint256);
}

interface IERC20MinimalV2 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

/// @notice Confidential-amount pool for the production-shaped Base Sepolia release.
contract GhostClawGnarkPlonkPoolV2 {
    uint256 public constant BN254_SCALAR_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 private constant SECP256K1N_HALF = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    uint256 public constant BASE_SEPOLIA_CHAIN_ID = 84532;
    uint256 public constant PROTOCOL_VERSION = 2;
    uint256 public constant TREE_DEPTH = 20;
    uint256 public constant TREE_CAPACITY = 1_048_576;
    uint256 public constant ROOT_HISTORY_SIZE = 256;
    uint256 public constant RECOVERY_DELAY = 7 days;
    uint256 public constant IDENTITY_ACTION_REGISTER = 1;
    uint256 public constant IDENTITY_ACTION_ROTATE = 2;
    uint256 public constant IDENTITY_ACTION_RECOVER = 3;
    uint256 private constant DOMAIN_IDENTITY_V2 = 7;
    uint256 private constant DOMAIN_WITHDRAWAL_V2 = 8;

    IERC20MinimalV2 public immutable token;
    IGhostClawGnarkVerifierV2 public immutable identityVerifier;
    IGhostClawGnarkVerifierV2 public immutable depositVerifier;
    IGhostClawGnarkVerifierV2 public immutable spendVerifier;
    IGhostClawGnarkVerifierV2 public immutable withdrawVerifier;
    IGhostClawPoseidon2V2 public immutable poseidon2;

    mapping(address account => uint256 owner) public ownerOf;
    mapping(uint256 owner => address account) public accountForOwner;
    mapping(uint256 owner => uint256 nonce) public identityNonce;
    mapping(uint256 root => bool exists) public roots;
    mapping(uint256 commitment => bool exists) public commitments;
    mapping(uint256 nullifier => bool spent) public nullifiers;
    mapping(uint256 paymentIntent => bool settled) public settledPaymentIntents;

    struct Recovery {
        address currentAccount;
        address newAccount;
        uint256 executeAfter;
        uint256 nonce;
    }

    mapping(uint256 owner => Recovery recovery) public pendingRecovery;

    uint256[21] public zeroes;
    uint256[20] public filledSubtrees;
    uint256[256] public recentRoots;
    uint256 public nextLeafIndex;
    uint256 public currentRoot;
    uint256 public rootCursor;
    uint256 public totalEscrowed;
    uint256 private locked;

    error BaseSepoliaOnly();
    error InvalidAddress();
    error InvalidFieldElement();
    error InvalidAmount();
    error InvalidIdentity();
    error IdentityAlreadyRegistered();
    error OwnerAlreadyRegistered();
    error SignatureExpired();
    error InvalidSignature();
    error InvalidProof();
    error InvalidIdentityAction();
    error UnknownRoot();
    error DuplicateRoot();
    error DuplicateCommitment();
    error NullifierAlreadySpent();
    error PaymentIntentAlreadySettled();
    error TreeFull();
    error RecoveryAlreadyPending();
    error RecoveryNotPending();
    error RecoveryDelayActive();
    error RecoveryAccountChanged();
    error TokenTransferFailed();
    error UnsupportedToken();
    error ReentrantCall();

    event IdentityRegistered(address indexed account, uint256 indexed owner, uint256 nonce);
    event AccountRotated(uint256 indexed owner, address indexed oldAccount, address indexed newAccount, uint256 nonce);
    event RecoveryRequested(
        uint256 indexed owner,
        address indexed currentAccount,
        address indexed newAccount,
        uint256 nonce,
        uint256 executeAfter
    );
    event RecoveryCancelled(uint256 indexed owner, address indexed account, uint256 nonce);
    event RecoveryFinalized(
        uint256 indexed owner, address indexed oldAccount, address indexed newAccount, uint256 nonce
    );
    event NotesInserted(uint256 indexed pairIndex, uint256 left, uint256 right, uint256 root);
    event Deposit(
        address indexed account,
        uint256 indexed owner,
        uint256 indexed commitment,
        uint256 amount,
        uint256 pairIndex,
        uint256 root
    );
    event X402Settlement(
        uint256 indexed paymentIntent,
        address indexed payer,
        address indexed merchant,
        uint256 senderOwner,
        uint256 recipientOwner,
        uint256 nullifier,
        uint256 outputLeft,
        uint256 outputRight,
        uint256 pairIndex,
        uint256 root
    );
    event Withdrawal(
        address indexed account,
        address indexed recipient,
        uint256 indexed nullifier,
        uint256 amount,
        uint256 changeCommitment,
        uint256 pairIndex,
        uint256 root
    );

    modifier nonReentrant() {
        _enter();
        _;
        locked = 1;
    }

    constructor(
        address tokenAddress,
        address identityVerifierAddress,
        address depositVerifierAddress,
        address spendVerifierAddress,
        address withdrawVerifierAddress,
        address poseidon2Address
    ) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert BaseSepoliaOnly();
        if (
            tokenAddress == address(0) || identityVerifierAddress == address(0) || depositVerifierAddress == address(0)
                || spendVerifierAddress == address(0) || withdrawVerifierAddress == address(0)
                || poseidon2Address == address(0)
        ) {
            revert InvalidAddress();
        }
        if (
            tokenAddress.code.length == 0 || identityVerifierAddress.code.length == 0
                || depositVerifierAddress.code.length == 0 || spendVerifierAddress.code.length == 0
                || withdrawVerifierAddress.code.length == 0 || poseidon2Address.code.length == 0
        ) {
            revert InvalidAddress();
        }
        token = IERC20MinimalV2(tokenAddress);
        identityVerifier = IGhostClawGnarkVerifierV2(identityVerifierAddress);
        depositVerifier = IGhostClawGnarkVerifierV2(depositVerifierAddress);
        spendVerifier = IGhostClawGnarkVerifierV2(spendVerifierAddress);
        withdrawVerifier = IGhostClawGnarkVerifierV2(withdrawVerifierAddress);
        poseidon2 = IGhostClawPoseidon2V2(poseidon2Address);

        zeroes[0] = 0;
        for (uint256 level = 1; level <= TREE_DEPTH; ++level) {
            zeroes[level] = poseidon2.hashPair(zeroes[level - 1], zeroes[level - 1]);
        }
        _rememberRoot(zeroes[TREE_DEPTH]);
    }

    function context() public view returns (uint256) {
        return uint256(uint160(address(this)));
    }

    function identityActionDigest(uint256 owner, address account, uint256 action, uint256 nonce)
        public
        view
        returns (uint256)
    {
        uint256 value = poseidon2.hashPair(DOMAIN_IDENTITY_V2, context());
        value = poseidon2.hashPair(value, owner);
        value = poseidon2.hashPair(value, uint256(uint160(account)));
        return poseidon2.hashPair(value, poseidon2.hashPair(action, nonce));
    }

    function accountConsentDigest(
        uint256 owner,
        address currentAccount,
        address newAccount,
        uint256 action,
        uint256 nonce,
        uint256 deadline
    ) public view returns (bytes32) {
        return keccak256(
            abi.encode(
                "GHOSTCLAW_V2_ACCOUNT_CONSENT",
                PROTOCOL_VERSION,
                block.chainid,
                address(this),
                owner,
                currentAccount,
                newAccount,
                action,
                nonce,
                deadline
            )
        );
    }

    function withdrawalActionDigest(uint256 owner, address payer, address recipient, uint64 amount)
        public
        view
        returns (uint256)
    {
        uint256 value = poseidon2.hashPair(DOMAIN_WITHDRAWAL_V2, context());
        value = poseidon2.hashPair(value, owner);
        value = poseidon2.hashPair(value, uint256(uint160(payer)));
        return poseidon2.hashPair(value, poseidon2.hashPair(uint256(uint160(recipient)), amount));
    }

    function registerSelf(bytes calldata proof, uint256 owner) external {
        if (ownerOf[msg.sender] != 0) revert IdentityAlreadyRegistered();
        if (accountForOwner[owner] != address(0)) revert OwnerAlreadyRegistered();
        _checkOwner(owner);
        _verifyIdentityProof(proof, owner, msg.sender, IDENTITY_ACTION_REGISTER, 0);
        ownerOf[msg.sender] = owner;
        accountForOwner[owner] = msg.sender;
        identityNonce[owner] = 1;
        emit IdentityRegistered(msg.sender, owner, 1);
    }

    function rotateAccount(
        bytes calldata proof,
        address newAccount,
        uint256 deadline,
        bytes calldata newAccountSignature
    ) external {
        uint256 owner = ownerOf[msg.sender];
        if (owner == 0) revert InvalidIdentity();
        _checkNewAccount(newAccount);
        if (block.timestamp > deadline) revert SignatureExpired();
        uint256 nonce = identityNonce[owner];
        _verifyIdentityProof(proof, owner, newAccount, IDENTITY_ACTION_ROTATE, nonce);
        _requireConsent(owner, msg.sender, newAccount, IDENTITY_ACTION_ROTATE, nonce, deadline, newAccountSignature);
        Recovery memory recovery = pendingRecovery[owner];
        if (recovery.newAccount != address(0)) {
            emit RecoveryCancelled(owner, msg.sender, recovery.nonce);
        }
        delete pendingRecovery[owner];
        identityNonce[owner] = nonce + 1;
        _moveIdentity(owner, msg.sender, newAccount);
        emit AccountRotated(owner, msg.sender, newAccount, nonce);
    }

    function requestRecovery(
        bytes calldata proof,
        uint256 owner,
        address newAccount,
        uint256 deadline,
        bytes calldata newAccountSignature
    ) external {
        address currentAccount = accountForOwner[owner];
        if (currentAccount == address(0) || ownerOf[currentAccount] != owner) revert InvalidIdentity();
        _checkNewAccount(newAccount);
        if (pendingRecovery[owner].newAccount != address(0)) revert RecoveryAlreadyPending();
        if (block.timestamp > deadline) revert SignatureExpired();
        uint256 nonce = identityNonce[owner];
        _verifyIdentityProof(proof, owner, newAccount, IDENTITY_ACTION_RECOVER, nonce);
        _requireConsent(
            owner, currentAccount, newAccount, IDENTITY_ACTION_RECOVER, nonce, deadline, newAccountSignature
        );
        uint256 executeAfter = block.timestamp + RECOVERY_DELAY;
        pendingRecovery[owner] = Recovery({
            currentAccount: currentAccount, newAccount: newAccount, executeAfter: executeAfter, nonce: nonce
        });
        identityNonce[owner] = nonce + 1;
        emit RecoveryRequested(owner, currentAccount, newAccount, nonce, executeAfter);
    }

    function cancelRecovery(uint256 owner) external {
        Recovery memory recovery = pendingRecovery[owner];
        if (recovery.newAccount == address(0)) revert RecoveryNotPending();
        if (accountForOwner[owner] != msg.sender || recovery.currentAccount != msg.sender) revert InvalidIdentity();
        delete pendingRecovery[owner];
        emit RecoveryCancelled(owner, msg.sender, recovery.nonce);
    }

    function finalizeRecovery(uint256 owner) external {
        Recovery memory recovery = pendingRecovery[owner];
        if (recovery.newAccount == address(0)) revert RecoveryNotPending();
        if (block.timestamp < recovery.executeAfter) revert RecoveryDelayActive();
        if (
            accountForOwner[owner] != recovery.currentAccount || ownerOf[recovery.currentAccount] != owner
                || ownerOf[recovery.newAccount] != 0
        ) {
            revert RecoveryAccountChanged();
        }
        delete pendingRecovery[owner];
        _moveIdentity(owner, recovery.currentAccount, recovery.newAccount);
        emit RecoveryFinalized(owner, recovery.currentAccount, recovery.newAccount, recovery.nonce);
    }

    function deposit(bytes calldata proof, uint256 commitment, uint64 amount) external nonReentrant {
        uint256 owner = ownerOf[msg.sender];
        if (owner == 0) revert InvalidIdentity();
        if (amount == 0) revert InvalidAmount();
        _checkNewCommitment(commitment);

        uint256[] memory inputs = new uint256[](4);
        inputs[0] = context();
        inputs[1] = commitment;
        inputs[2] = amount;
        inputs[3] = owner;
        if (!depositVerifier.Verify(proof, inputs)) revert InvalidProof();

        uint256 beforeBalance = token.balanceOf(address(this));
        _safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != beforeBalance + amount) revert UnsupportedToken();

        commitments[commitment] = true;
        (uint256 pairIndex, uint256 root) = _appendPair(commitment, 0);
        totalEscrowed += amount;
        emit Deposit(msg.sender, owner, commitment, amount, pairIndex, root);
    }

    function confidentialTransfer(
        bytes calldata proof,
        uint256 spendRoot,
        uint256 nullifier,
        uint256 outputLeft,
        uint256 outputRight,
        uint256 recipientOwner,
        uint256 paymentIntent,
        address merchant
    ) external nonReentrant {
        uint256 senderOwner = ownerOf[msg.sender];
        if (senderOwner == 0 || ownerOf[merchant] != recipientOwner || recipientOwner == 0) revert InvalidIdentity();
        if (!roots[spendRoot]) revert UnknownRoot();
        if (nullifiers[nullifier]) revert NullifierAlreadySpent();
        if (settledPaymentIntents[paymentIntent]) revert PaymentIntentAlreadySettled();
        _checkField(nullifier);
        _checkNewCommitment(outputLeft);
        _checkNewCommitment(outputRight);
        if (outputLeft == outputRight) revert DuplicateCommitment();
        _checkField(paymentIntent);

        uint256[] memory inputs = new uint256[](10);
        inputs[0] = context();
        inputs[1] = spendRoot;
        inputs[2] = nullifier;
        inputs[3] = outputLeft;
        inputs[4] = outputRight;
        inputs[5] = senderOwner;
        inputs[6] = recipientOwner;
        inputs[7] = paymentIntent;
        inputs[8] = uint256(uint160(msg.sender));
        inputs[9] = uint256(uint160(merchant));
        if (!spendVerifier.Verify(proof, inputs)) revert InvalidProof();

        nullifiers[nullifier] = true;
        settledPaymentIntents[paymentIntent] = true;
        commitments[outputLeft] = true;
        commitments[outputRight] = true;
        (uint256 pairIndex, uint256 root) = _appendPair(outputLeft, outputRight);
        emit X402Settlement(
            paymentIntent,
            msg.sender,
            merchant,
            senderOwner,
            recipientOwner,
            nullifier,
            outputLeft,
            outputRight,
            pairIndex,
            root
        );
    }

    function withdraw(
        bytes calldata proof,
        uint256 spendRoot,
        uint256 nullifier,
        uint256 changeCommitment,
        address recipient,
        uint64 amount
    ) external nonReentrant {
        uint256 owner = ownerOf[msg.sender];
        if (owner == 0) revert InvalidIdentity();
        if (recipient == address(0)) revert InvalidAddress();
        if (amount == 0 || amount > totalEscrowed) revert InvalidAmount();
        if (!roots[spendRoot]) revert UnknownRoot();
        if (nullifiers[nullifier]) revert NullifierAlreadySpent();
        _checkField(nullifier);
        if (changeCommitment != 0) _checkNewCommitment(changeCommitment);

        uint256[] memory inputs = new uint256[](7);
        inputs[0] = context();
        inputs[1] = spendRoot;
        inputs[2] = nullifier;
        inputs[3] = changeCommitment;
        inputs[4] = owner;
        inputs[5] = withdrawalActionDigest(owner, msg.sender, recipient, amount);
        inputs[6] = amount;
        if (!withdrawVerifier.Verify(proof, inputs)) revert InvalidProof();

        nullifiers[nullifier] = true;
        if (changeCommitment != 0) commitments[changeCommitment] = true;
        (uint256 pairIndex, uint256 root) = _appendPair(changeCommitment, 0);
        totalEscrowed -= amount;
        uint256 beforeBalance = token.balanceOf(address(this));
        _safeTransfer(recipient, amount);
        if (token.balanceOf(address(this)) + amount != beforeBalance) revert UnsupportedToken();
        emit Withdrawal(msg.sender, recipient, nullifier, amount, changeCommitment, pairIndex, root);
    }

    function _appendPair(uint256 left, uint256 right) private returns (uint256 pairIndex, uint256 root) {
        if (nextLeafIndex + 2 > TREE_CAPACITY) revert TreeFull();
        pairIndex = nextLeafIndex >> 1;
        uint256 index = pairIndex;
        uint256 node = poseidon2.hashPair(left, right);
        for (uint256 level = 1; level < TREE_DEPTH; ++level) {
            if ((index & 1) == 0) {
                filledSubtrees[level] = node;
                node = poseidon2.hashPair(node, zeroes[level]);
            } else {
                node = poseidon2.hashPair(filledSubtrees[level], node);
            }
            index >>= 1;
        }
        nextLeafIndex += 2;
        currentRoot = node;
        _rememberRoot(node);
        emit NotesInserted(pairIndex, left, right, node);
        return (pairIndex, node);
    }

    function _rememberRoot(uint256 root) internal {
        _checkField(root);
        // A full withdrawal appends an all-zero pair. The logical root can stay
        // unchanged even though the public append index advances.
        if (roots[root]) {
            if (root == currentRoot) return;
            revert DuplicateRoot();
        }
        uint256 oldRoot = recentRoots[rootCursor];
        if (oldRoot != 0) roots[oldRoot] = false;
        recentRoots[rootCursor] = root;
        roots[root] = true;
        currentRoot = root;
        rootCursor = (rootCursor + 1) % ROOT_HISTORY_SIZE;
    }

    function _verifyIdentityProof(bytes calldata proof, uint256 owner, address account, uint256 action, uint256 nonce)
        private
        view
    {
        uint256[] memory inputs = new uint256[](3);
        inputs[0] = context();
        inputs[1] = owner;
        inputs[2] = identityActionDigest(owner, account, action, nonce);
        if (!identityVerifier.Verify(proof, inputs)) revert InvalidProof();
    }

    function _requireConsent(
        uint256 owner,
        address currentAccount,
        address newAccount,
        uint256 action,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) private view {
        bytes32 consent = accountConsentDigest(owner, currentAccount, newAccount, action, nonce, deadline);
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", consent));
        if (_recover(digest, signature) != newAccount) revert InvalidSignature();
    }

    function _checkNewAccount(address account) private view {
        if (account == address(0) || ownerOf[account] != 0) revert InvalidIdentity();
    }

    function _moveIdentity(uint256 owner, address oldAccount, address newAccount) private {
        ownerOf[oldAccount] = 0;
        ownerOf[newAccount] = owner;
        accountForOwner[owner] = newAccount;
    }

    function _checkOwner(uint256 owner) private pure {
        if (owner == 0 || owner >= BN254_SCALAR_FIELD) revert InvalidIdentity();
    }

    function _checkField(uint256 value) private pure {
        if (value == 0 || value >= BN254_SCALAR_FIELD) revert InvalidFieldElement();
    }

    function _checkNewCommitment(uint256 commitment) private view {
        _checkField(commitment);
        if (commitments[commitment]) revert DuplicateCommitment();
    }

    function _enter() private {
        if (locked == 2) revert ReentrantCall();
        locked = 2;
    }

    function _safeTransfer(address recipient, uint256 amount) private {
        (bool success, bytes memory result) =
            address(token).call(abi.encodeCall(IERC20MinimalV2.transfer, (recipient, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenTransferFailed();
    }

    function _safeTransferFrom(address sender, address recipient, uint256 amount) private {
        (bool success, bytes memory result) =
            address(token).call(abi.encodeCall(IERC20MinimalV2.transferFrom, (sender, recipient, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) revert TokenTransferFailed();
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (uint256(s) > SECP256K1N_HALF || (v != 27 && v != 28)) revert InvalidSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
    }
}
