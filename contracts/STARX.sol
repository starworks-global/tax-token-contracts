// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "./TaxToken.sol";

contract STARX is TaxToken {
    constructor(
        address defaultAdmin_,
        address initialHolder_,
        TaxRecipient[] memory taxRecipients_
    ) TaxToken("STARX", "STARX", defaultAdmin_, taxRecipients_) {
        _mint(initialHolder_, 1000000000 * 10 ** 18);
    }
}
