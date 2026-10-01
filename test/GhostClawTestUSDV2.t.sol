// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {GhostClawTestUSDV2} from "../contracts/GhostClawTestUSDV2.sol";

interface VmTokenV2 {
    function expectRevert(bytes4 selector) external;
    function prank(address sender) external;
}

contract GhostClawTestUSDV2Test {
    VmTokenV2 private constant VM = VmTokenV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    GhostClawTestUSDV2 private token;
    address private constant USER = address(0xA11CE);
    address private constant RECIPIENT = address(0xB0B);

    function setUp() public {
        token = new GhostClawTestUSDV2();
    }

    function testEachAddressReceivesExactlyOneHundredTestTokensOnce() public {
        VM.prank(USER);
        token.faucet();
        assert(token.balanceOf(USER) == 100_000_000);
        assert(token.totalSupply() == 100_000_000);
        VM.prank(USER);
        VM.expectRevert(GhostClawTestUSDV2.FaucetAlreadyUsed.selector);
        token.faucet();
    }

    function testTransferFromUsesAnExactBalanceDelta() public {
        VM.prank(USER);
        token.faucet();
        VM.prank(USER);
        token.approve(address(this), 25_000_000);
        token.transferFrom(USER, RECIPIENT, 25_000_000);
        assert(token.balanceOf(USER) == 75_000_000);
        assert(token.balanceOf(RECIPIENT) == 25_000_000);
        assert(token.allowance(USER, address(this)) == 0);
    }
}
