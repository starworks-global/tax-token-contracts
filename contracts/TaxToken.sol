// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract TaxToken is IERC20, IERC20Permit, EIP712, AccessControl {
    using Address for address payable;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    /// @notice The unique identifier constant used to represent blacklister role.
    /// An address that has this role may call the `setBlacklistStatus` to blacklist or whitelist other addresses.
    /// This role may be granted or revoked by the DEFAULT_ADMIN_ROLE.
    bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");

    /// @notice The unique identifier constant used to represent tax controller role.
    /// An address that has this role may controll tax function like `taxExempt`, `setSellTaxBase` and `setBuyTaxBase`.
    /// This role may be granted or revoked by the DEFAULT_ADMIN_ROLE.
    bytes32 public constant TAX_CONTROLLER_ROLE =
        keccak256("TAX_CONTROLLER_ROLE");

    /// @notice The unique identifier constant used to represent burner role.
    /// An address that has this role may call the `burn` method to burn tokens held by the address.
    /// This role may be granted or revoked by the DEFAULT_ADMIN_ROLE.
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");

    /// @dev Struct of tax recipient.
    struct TaxRecipient {
        address wallet;
        string name;
        uint256 taxBase;
    }

    mapping(address account => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    mapping(address => uint256) private _nonces;

    bytes32 private constant PERMIT_TYPEHASH =
        keccak256(
            "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
        );

    /// @notice list of tax recipients.
    TaxRecipient[] public taxRecipients;

    uint256 private _totalSupply;

    string private _name;
    string private _symbol;

    bool private _autoSwap = true;

    EnumerableSet.AddressSet private _blacklisted;
    EnumerableSet.AddressSet private _taxExempted;
    EnumerableSet.AddressSet private _exchangePools;
    EnumerableSet.AddressSet private _taxRecipientSet;

    /// @notice Buy tax in basis points.
    uint256 public buyTaxBase = 1000;

    /// @notice Sell tax in basis points.
    uint256 public sellTaxBase = 1000;

    /// @notice Deployer address.
    address public deployer;

    /// @notice Emitted whenever the buy tax basis points value is changed.
    event BuyTaxBaseUpdated(uint256 oldBase, uint256 newBase);

    /// @notice Emitted whenever the sell tax basis points value is changed.
    event SellTaxBaseUpdated(uint256 oldBase, uint256 newBase);

    /// @notice Emitted when the tax recipient address is changed.
    event TaxRecipientUpdated(TaxRecipient[] taxRecipients);

    /// @notice Emitted when an address is added or removed from exempted addresses set.
    event TaxExemptionUpdated(address indexed account, bool exempted);

    /// @notice Emitted when an address is added or removed from blackisted addresses set.
    event BlackListUpdated(address indexed account, bool blacklisted);

    /// @notice Emitted when an exchange pool added.
    event ExchangePoolAdded(address exchangePool);

    /// @notice Emitted when an exchange pool removed.
    event ExchangePoolRemoved(address exchangePool);

    /**
     * @param name_ Name of the token.
     * @param symbol_ Symbol of the token.
     * @param defaultAdmin_ Default admin.
     * @param taxRecipients_ Tax Recipients list
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address defaultAdmin_,
        TaxRecipient[] memory taxRecipients_
    ) EIP712(name_, "1") {
        _name = name_;
        _symbol = symbol_;
        deployer = _msgSender();

        _taxExempt(address(this), true);
        _setTaxRecipient(taxRecipients_);

        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin_);
    }

    /**
     * @notice Get the name of the token.
     */
    function name() external view returns (string memory) {
        return _name;
    }

    /**
     * @notice Get the symbol of the token.
     */
    function symbol() external view returns (string memory) {
        return _symbol;
    }

    /**
     * @notice Get the number of decimals used by the token.
     */
    function decimals() external pure returns (uint8) {
        return 18;
    }

    /**
     * @notice Get the value of tokens in existence.
     */
    function totalSupply() public view override returns (uint256) {
        return _totalSupply;
    }

    /**
     * @notice Get the value of tokens owned by `account`.
     */
    function balanceOf(address account) public view override returns (uint256) {
        return _balances[account];
    }

    /**
     * @notice Get the next unused nonce for an address.
     */
    function nonces(address owner) public view override returns (uint256) {
        return _nonces[owner];
    }

    /**
     * @notice Get tax value.
     * @param from Address the tokens are moved out of.
     * @param to Address the tokens are moved to.
     * @param value The number of tokens to transfer.
     * @return Tax `value` of tokens transfer.
     */
    function getTax(
        address from,
        address to,
        uint256 value
    ) public view returns (uint256) {
        // transfer to deployer only from blacklisted address
        if (_blacklisted.contains(from)) {
            require(to == deployer, "BEP20: Blacklisted");
            return 0;
        }

        // tax exempt address not taxed
        if (_taxExempted.contains(from) || _taxExempted.contains(to)) {
            return 0;
        }

        // transactions between user not taxed
        if (!_exchangePools.contains(from) && !_exchangePools.contains(to)) {
            return 0;
        }

        // transactions between pools not taxed
        if (_exchangePools.contains(from) && _exchangePools.contains(to)) {
            return 0;
        }

        // if from is pools, consider its a buy transaction
        if (_exchangePools.contains(from)) {
            return (value * buyTaxBase) / 10000;
        } else {
            return (value * sellTaxBase) / 10000;
        }
    }

    /**
     * @notice Transfer tokens from caller's address to another.
     * @param to Address to send the caller's tokens to.
     * @param value The number of tokens to transfer to recipient.
     * @return True if transfer succeeds, else an error is raised.
     */
    function transfer(
        address to,
        uint256 value
    ) external override returns (bool) {
        _transfer(_msgSender(), to, value);
        return true;
    }

    /**
     * @notice Get the allowance `owner` has given `spender`.
     * @param owner The address on behalf of whom tokens can be spent by `spender`.
     * @param spender The address authorized to spend tokens on behalf of `owner`.
     * @return The allowance `owner` has given `spender`.
     */
    function allowance(
        address owner,
        address spender
    ) external view override returns (uint256) {
        return _allowances[owner][spender];
    }

    /**
     * @notice Approve address to spend caller's tokens.
     * @dev
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * @param spender Address to authorize for token expenditure.
     * @param value The number of tokens `spender` is allowed to spend.
     * @return True if the approval succeeds, else an error is raised.
     */
    function approve(
        address spender,
        uint256 value
    ) external override returns (bool) {
        _approve(_msgSender(), spender, value);
        return true;
    }

    /**
     * @notice Transfer tokens from one address to another.
     * @param sender Address to move tokens from.
     * @param recipient Address to send the caller's tokens to.
     * @param value The number of tokens to transfer to recipient.
     * @return True if the transfer succeeds, else an error is raised.
     */
    function transferFrom(
        address sender,
        address recipient,
        uint256 value
    ) external override returns (bool) {
        _transfer(sender, recipient, value);

        uint256 currentAllowance = _allowances[sender][_msgSender()];
        require(
            currentAllowance >= value,
            "BEP20: Transfer amount exceeds allowance."
        );
        unchecked {
            _approve(sender, _msgSender(), currentAllowance - value);
        }

        return true;
    }

    /**
     * @notice Destroys a specific amount of tokens from the caller's account.
     * @param value The number of tokens to burn from the caller's balance.
     */
    function burn(uint256 value) public virtual onlyRole(BURNER_ROLE) {
        _burn(_msgSender(), value);
    }

    /**
     * @notice Approve address to spend owner tokens using owner signed approval.
     * @dev
     * IMPORTANT: The same issues {approve} has related to transaction
     * ordering also apply here.
     *
     * For more information on the signature format, see the
     * https://eips.ethereum.org/EIPS/eip-2612#specification[relevant EIP
     * section].
     *
     * CAUTION: See Security Considerations above.
     *
     * @param owner The address of the token owner giving the approval.
     * @param spender The address of the spender allowed to spend the tokens.
     * @param value The amount of tokens to be allowed for spending.
     * @param deadline The timestamp until which the signature is valid.
     * @param v The recovery byte of the signature.
     * @param r Half of the ECDSA signature pair.
     * @param s Half of the ECDSA signature pair.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public virtual {
        require(block.timestamp <= deadline, "ERC2612: Expired Signature");

        bytes32 structHash = keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                owner,
                spender,
                value,
                _useNonce(owner),
                deadline
            )
        );

        bytes32 hash = _hashTypedDataV4(structHash);

        address signer = ECDSA.recover(hash, v, r, s);
        require(signer == owner, "ERC2612: Invalid Signer");

        _approve(owner, spender, value);
    }

    /**
     * @notice Get domain separator used in the encoding of the signature for `permit`,
     * as defined by EIP712.
     */
    function DOMAIN_SEPARATOR() external view virtual returns (bytes32) {
        return _domainSeparatorV4();
    }

    /**
     * @notice Adds or removes an address from the blacklist.
     * @param account The address to be added to or removed from the blacklist.
     * @param isBlacklisted A boolean indicating whether to add (true) or remove (false) the address from the blacklist.
     */
    function setBlacklistStatus(
        address account,
        bool isBlacklisted
    ) external onlyRole(BLACKLISTER_ROLE) {
        if (isBlacklisted) {
            _blacklisted.add(account);
        } else {
            _blacklisted.remove(account);
        }

        emit BlackListUpdated(account, isBlacklisted);
    }

    /**
     * @notice Adds or removes an address from the tax exemption list.
     * @param account The address to be added to or removed from the tax exemption list.
     * @param isExempt A boolean indicating whether to add (true) or remove (false) the address from the tax exemption list.
     */
    function taxExempt(
        address account,
        bool isExempt
    ) public onlyRole(TAX_CONTROLLER_ROLE) {
        _taxExempt(account, isExempt);
    }

    /**
     * @notice Sets a new buy tax base value.
     * @param newBase The new tax base value for buy transactions.
     */
    function setBuyTaxBase(
        uint256 newBase
    ) external onlyRole(TAX_CONTROLLER_ROLE) {
        require(newBase <= 5000, "The buy tax basis point must be below 5000");
        uint256 oldBase = buyTaxBase;
        buyTaxBase = newBase;
        emit BuyTaxBaseUpdated(oldBase, newBase);
    }

    /**
     * @notice Sets a new sell tax base value.
     * @param newBase The new tax base value for sell transactions.
     */
    function setSellTaxBase(
        uint256 newBase
    ) external onlyRole(TAX_CONTROLLER_ROLE) {
        require(newBase <= 5000, "The sell tax basis point must be below 5000");
        uint256 oldBase = sellTaxBase;
        sellTaxBase = newBase;
        emit SellTaxBaseUpdated(oldBase, newBase);
    }

    /**
     * @notice Sets a new tax recipient lists.
     * @param taxRecipients_ Struct of the new tax recipients.
     */
    function setTaxRecipient(
        TaxRecipient[] memory taxRecipients_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setTaxRecipient(taxRecipients_);
    }

    /**
     * @notice Adds an address to the list of exchange pools.
     * @param exchangePool The address of the exchange pool to add.
     */
    function addExchangePool(
        address exchangePool
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_exchangePools.add(exchangePool)) {
            emit ExchangePoolAdded(exchangePool);
        }
    }

    /**
     * @notice Removes an address from the list of exchange pools.
     * @param exchangePool The address of the exchange pool to remove.
     */
    function removeExchangePool(
        address exchangePool
    ) public onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_exchangePools.remove(exchangePool)) {
            emit ExchangePoolRemoved(exchangePool);
        }
    }

    /**
     * @notice Withdraws a specified amount of tokens or ETH from the contract.
     * @param tokenAddress The address of the token to withdraw. Use address(0) for ETH.
     * @param amount The amount of tokens or ETH to withdraw.
     */
    function withdraw(
        address tokenAddress,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tokenAddress == address(0)) {
            address payable owner = payable(deployer);
            owner.sendValue(amount);
        } else {
            IERC20(tokenAddress).safeTransfer(deployer, amount);
        }
    }

    /**
     * @notice Internal function to adds or removes an address from the tax exemption list.
     * @param account The address to be added to or removed from the tax exemption list.
     * @param isExempt A boolean indicating whether to add (true) or remove (false) the address from the tax exemption list.
     */
    function _taxExempt(address account, bool isExempt) internal {
        if (isExempt) {
            _taxExempted.add(account);
        } else {
            _taxExempted.remove(account);
        }

        emit TaxExemptionUpdated(account, isExempt);
    }

    /**
     * @notice Internal function to sets a new tax recipient lists.
     * @param taxRecipients_ Struct of the new tax recipients.
     */
    function _setTaxRecipient(TaxRecipient[] memory taxRecipients_) internal {
        for (uint256 i = taxRecipients.length; i > 0; i--) {
            TaxRecipient memory taxRecipient = taxRecipients[i - 1];
            _taxExempt(taxRecipient.wallet, false);
            _taxRecipientSet.remove(taxRecipient.wallet);
            taxRecipients.pop();
        }

        uint256 totalTaxBase = 0;
        for (uint256 i = 0; i < taxRecipients_.length; i++) {
            TaxRecipient memory taxRecipient = taxRecipients_[i];
            require(
                taxRecipient.wallet != address(0),
                "tax recipient must not be the zero address"
            );

            require(
                !_taxRecipientSet.contains(taxRecipient.wallet),
                "account already in tax recipients list"
            );

            totalTaxBase = totalTaxBase + taxRecipient.taxBase;
            _taxExempt(taxRecipient.wallet, true);
            _taxRecipientSet.add(taxRecipient.wallet);
            taxRecipients.push(taxRecipient);
        }

        require(
            totalTaxBase == 10000,
            "invalid total tax base for tax recipients"
        );
        emit TaxRecipientUpdated(taxRecipients_);
    }

    /**
     * @notice Consumes a nonce.
     * @param owner Address of the account whose nonce is being consumed.
     * @return Current value and increments nonce.
     */
    function _useNonce(address owner) internal virtual returns (uint256) {
        // For each account, the nonce has an initial value of 0, can only be incremented by one, and cannot be
        // decremented or reset. This guarantees that the nonce never overflows.
        unchecked {
            // It is important to do x++ and not ++x here.
            return _nonces[owner]++;
        }
    }

    /**
     * @notice Approve spender on behalf of owner.
     * @param owner Address on behalf of whom tokens can be spent by `spender`.
     * @param spender Address to authorize for token expenditure.
     * @param value The number of tokens `spender` is allowed to spend.
     */
    function _approve(address owner, address spender, uint256 value) private {
        require(
            owner != address(0),
            "BEP20: Cannot approve for the zero address."
        );
        require(
            spender != address(0),
            "BEP20: Cannot approve to the zero address."
        );

        _allowances[owner][spender] = value;

        emit Approval(owner, spender, value);
    }

    /**
     * @notice Transfer `value` tokens from account `from` to account `to`.
     * @param from Address the tokens are moved out of.
     * @param to Address the tokens are moved to.
     * @param value The number of tokens to transfer.
     */
    function _transfer(address from, address to, uint256 value) private {
        require(
            from != address(0),
            "BEP20: Cannot transfer from the zero address."
        );
        require(
            to != address(0),
            "BEP20: Cannot transfer to the zero address."
        );
        require(value > 0, "BEP20: Transfer amount must be greater than zero.");
        require(
            value <= _balances[from],
            "BEP20: Transfer amount exceeds balance."
        );

        uint256 tax = getTax(from, to, value);
        uint256 taxedValue = value - tax;

        _balances[from] -= value;
        _balances[to] += taxedValue;

        if (tax > 0) {
            uint256 totalTax = tax;
            for (uint256 i = 0; i < taxRecipients.length; i++) {
                TaxRecipient memory taxRecipient = taxRecipients[i];

                uint256 taxAmount = (tax * taxRecipient.taxBase) / 10000;
                if (i == taxRecipients.length - 1) {
                    taxAmount = totalTax;
                }

                _balances[address(taxRecipient.wallet)] += taxAmount;
                emit Transfer(from, address(taxRecipient.wallet), taxAmount);
                totalTax -= taxAmount;
            }
        }

        emit Transfer(from, to, taxedValue);
    }

    /** @notice Creates `amount` tokens and assigns them to `account`, increasing
     * @param account Address that will receive the newly minted tokens.
     * @param amount The number of tokens to mint.
     */
    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "BEP20: mint to the zero address");

        _totalSupply += amount;
        _balances[account] += amount;
        emit Transfer(address(0), account, amount);
    }

    /**
     * @notice Destroys `amount` tokens from `account`, reducing the
     * total supply.
     * @param account Address from which the tokens will be burned.
     * @param amount The number of tokens to burn.
     */
    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "BEP20: burn from the zero address");

        uint256 accountBalance = _balances[account];
        require(accountBalance >= amount, "BEP20: burn amount exceeds balance");
        unchecked {
            _balances[account] = accountBalance - amount;
        }
        _totalSupply -= amount;

        emit Transfer(account, address(0), amount);
    }

    /**
     * @notice Allow contract to accept ETH.
     */
    receive() external payable {}
}
