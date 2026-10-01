// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {GhostClawPoseidon2BN254} from "../contracts/generated/GhostClawPoseidon2BN254.sol";

contract Poseidon2BN254Test {
    GhostClawPoseidon2BN254 private hasher;

    function setUp() public {
        hasher = new GhostClawPoseidon2BN254();
    }

    function testMatchesGnarkCryptoVectors() public view {
        assert(hasher.hashPair(0, 0) == 18622970401557034651033185129330286139447343337105683528700775943440799145467);
        assert(hasher.hashPair(1, 2) == 1313337560616139085277676701856612540166622156368305732529371734734451176752);
        assert(
            hasher.hashPair(21888242871839275222246405745257275088548364400416034343698204186575808495616, 42)
                == 16270376293756083560835989435795346588834753750058541767405178647798154411041
        );
    }

    function testRejectsOutOfFieldInput() public {
        try hasher.hashPair(hasher.FIELD(), 0) {
            revert("out-of-field input was accepted");
        } catch (bytes memory reason) {
            assert(bytes4(reason) == GhostClawPoseidon2BN254.FieldElementOutOfRange.selector);
        }
    }
}
