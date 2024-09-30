import { expect } from "chai";
import { parseEther, parseUnits, Signer } from "ethers";
import { ethers } from "hardhat";
import { STARX } from "../typechain-types";

const TOTAL_SUPPLY = 1_000_000_000;
const INITIAL_BUY_TAX_BASE = 1000;
const INITIAL_SELL_TAX_BASE = 1000;

describe("STARX", function () {
  async function createPermit(
    starx: STARX,
    owner: Signer,
    spender: Signer,
    valueToSend: string
  ) {
    const domainSeparator = {
      name: "STARX",
      version: "1",
      chainId: 31337,
      verifyingContract: await starx.getAddress(),
    };

    const types = {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    const deadline = Math.floor(new Date().getTime() / 1000) + 3600;
    const value = {
      owner: await owner.getAddress(),
      spender: await spender.getAddress(),
      value: parseUnits(valueToSend, "wei"),
      nonce: await starx.nonces(owner.getAddress()),
      deadline,
    };

    const signature = await owner.signTypedData(domainSeparator, types, value);
    const { r, s, v } = ethers.Signature.from(signature);
    return { deadline, v, r, s };
  }

  async function getTax(
    starx: STARX,
    from: Signer,
    to: Signer,
    amount: string
  ) {
    const fromAddress = await from.getAddress();
    const toAddress = await to.getAddress();
    return starx.getTax(fromAddress, toAddress, parseUnits(amount, "wei"));
  }

  async function deployFixture() {
    const [
      owner,
      operator,
      taxRecipient1,
      taxRecipient2,
      taxRecipient3,
      exchangePool1,
      exchangePool2,
      user1,
      user2,
      admin,
      blacklister,
      taxController,
      burner,
      initialHolder,
    ] = await ethers.getSigners();
    const starx = await ethers.deployContract("STARX", [
      admin.address,
      initialHolder.address,
      [
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 3000,
        },
        {
          wallet: taxRecipient2.address,
          name: "Tax Recipient 2",
          taxBase: 3000,
        },
        {
          wallet: taxRecipient3.address,
          name: "Tax Recipient 2",
          taxBase: 4000,
        },
      ],
    ]);
    await starx.waitForDeployment();
    await starx
      .connect(admin)
      .grantRole(await starx.BLACKLISTER_ROLE(), blacklister.address);
    await starx
      .connect(admin)
      .grantRole(await starx.TAX_CONTROLLER_ROLE(), taxController.address);
    await starx
      .connect(admin)
      .grantRole(await starx.BURNER_ROLE(), burner.address);

    return {
      starx,
      owner,
      user1,
      user2,
      operator,
      exchangePool1,
      exchangePool2,
      taxRecipient1,
      taxRecipient2,
      taxRecipient3,
      admin,
      blacklister,
      taxController,
      burner,
      initialHolder,
    };
  }

  describe("General", function () {
    it("should deploy", async function () {
      const { starx, initialHolder } = await deployFixture();

      const wallet1Balance = await starx.balanceOf(initialHolder.address);
      expect(Number(ethers.formatEther(wallet1Balance))).to.equal(TOTAL_SUPPLY);

      const totalSupply = await starx.totalSupply();
      expect(Number(ethers.formatEther(totalSupply))).to.equal(TOTAL_SUPPLY);
    });

    it("should black list", async function () {
      const { starx, blacklister, user1 } = await deployFixture();

      const trx = await starx
        .connect(blacklister)
        .setBlacklistStatus(user1.address, true);

      await expect(trx)
        .to.emit(starx, "BlackListUpdated")
        .withArgs(user1.address, true);
    });

    it("should whitelist", async function () {
      const { starx, blacklister, user1 } = await deployFixture();

      await starx.connect(blacklister).setBlacklistStatus(user1.address, true);

      const trx = await starx
        .connect(blacklister)
        .setBlacklistStatus(user1.address, false);

      await expect(trx)
        .to.emit(starx, "BlackListUpdated")
        .withArgs(user1.address, false);
    });

    it("should revert on black list without role", async function () {
      const { starx, taxController, user1 } = await deployFixture();

      await expect(
        starx.connect(taxController).setBlacklistStatus(user1.address, true)
      )
        .to.be.revertedWithCustomError(
          starx,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(taxController.address, await starx.BLACKLISTER_ROLE());
    });

    it("should tax exempt address", async function () {
      const { starx, taxController, user1 } = await deployFixture();

      const trx = await starx
        .connect(taxController)
        .taxExempt(user1.address, true);

      await expect(trx)
        .to.emit(starx, "TaxExemptionUpdated")
        .withArgs(user1.address, true);
    });

    it("should revert without tax controller role", async function () {
      const { starx, blacklister, user1 } = await deployFixture();

      await expect(starx.connect(blacklister).taxExempt(user1.address, true))
        .to.be.revertedWithCustomError(
          starx,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(blacklister.address, await starx.TAX_CONTROLLER_ROLE());
    });

    it("should remove address from exempt list", async function () {
      const { starx, taxController, user1 } = await deployFixture();

      await starx.connect(taxController).taxExempt(user1.address, true);
      const trx = await starx
        .connect(taxController)
        .taxExempt(user1.address, false);
      await expect(trx)
        .to.emit(starx, "TaxExemptionUpdated")
        .withArgs(user1.address, false);
    });

    it("should set buy tax base", async function () {
      const { starx, taxController } = await deployFixture();

      const trx = await starx.connect(taxController).setBuyTaxBase(500);
      await expect(trx)
        .to.emit(starx, "BuyTaxBaseUpdated")
        .withArgs(INITIAL_BUY_TAX_BASE, 500);
    });

    it("should set sell tax base", async function () {
      const { starx, taxController } = await deployFixture();

      const trx = await starx.connect(taxController).setSellTaxBase(500);
      await expect(trx)
        .to.emit(starx, "SellTaxBaseUpdated")
        .withArgs(INITIAL_SELL_TAX_BASE, 500);
    });

    it("should revert if buy tax base more than 5000", async function () {
      const { starx, taxController } = await deployFixture();

      const trx = starx.connect(taxController).setBuyTaxBase(6000);
      await expect(trx).to.be.revertedWith(
        "The buy tax basis point must be below 5000"
      );
    });

    it("should revert if sell tax base more than 5000", async function () {
      const { starx, taxController } = await deployFixture();

      const trx = starx.connect(taxController).setSellTaxBase(6000);
      await expect(trx).to.be.revertedWith(
        "The sell tax basis point must be below 5000"
      );
    });

    it("should add exchange pool", async function () {
      const { starx, admin, exchangePool1 } = await deployFixture();

      const trx = await starx
        .connect(admin)
        .addExchangePool(exchangePool1.address);
      await expect(trx)
        .to.emit(starx, "ExchangePoolAdded")
        .withArgs(exchangePool1.address);
    });

    it("should remove exchange pool", async function () {
      const { starx, admin, exchangePool1 } = await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);
      const trx = await starx
        .connect(admin)
        .removeExchangePool(exchangePool1.address);
      await expect(trx)
        .to.emit(starx, "ExchangePoolRemoved")
        .withArgs(exchangePool1.address);
    });

    it("should set tax recipient", async function () {
      const { starx, admin, taxRecipient1, taxRecipient2 } =
        await deployFixture();

      const trx = await starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: taxRecipient2.address,
          name: "Tax Recipient 2",
          taxBase: 5000,
        },
      ]);

      await expect(trx)
        .to.emit(starx, "TaxRecipientUpdated")
        .withArgs([
          [taxRecipient1.address, "Tax Recipient 1", 5000],
          [taxRecipient2.address, "Tax Recipient 2", 5000],
        ]);
    });

    it("should replace tax recipient", async function () {
      const { starx, admin, taxRecipient1, taxRecipient2, taxRecipient3 } =
        await deployFixture();

      let trx = await starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: taxRecipient2.address,
          name: "Tax Recipient 2",
          taxBase: 5000,
        },
      ]);

      await expect(trx)
        .to.emit(starx, "TaxRecipientUpdated")
        .withArgs([
          [taxRecipient1.address, "Tax Recipient 1", 5000],
          [taxRecipient2.address, "Tax Recipient 2", 5000],
        ]);

      trx = await starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 6000,
        },
        {
          wallet: taxRecipient3.address,
          name: "Tax Recipient 2",
          taxBase: 4000,
        },
      ]);

      await expect(trx)
        .to.emit(starx, "TaxRecipientUpdated")
        .withArgs([
          [taxRecipient1.address, "Tax Recipient 1", 6000],
          [taxRecipient3.address, "Tax Recipient 2", 4000],
        ]);
    });

    it("should revert when set tax recipient with same address", async function () {
      const { starx, admin, taxRecipient1, taxRecipient2 } =
        await deployFixture();

      const trx = starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: taxRecipient2.address,
          name: "Tax Recipient 2",
          taxBase: 3000,
        },
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 2",
          taxBase: 2000,
        },
      ]);

      await expect(trx).to.be.revertedWith(
        "account already in tax recipients list"
      );
    });

    it("should revert if tax recipient is zero address", async function () {
      const { starx, admin, taxRecipient1 } = await deployFixture();

      const trx = starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: "0x0000000000000000000000000000000000000000",
          name: "Tax Recipient 2",
          taxBase: 5000,
        },
      ]);

      await expect(trx).to.be.revertedWith(
        "tax recipient must not be the zero address"
      );
    });

    it("should revert if total tax base not 10000", async function () {
      const { starx, admin, taxRecipient1, taxRecipient2 } =
        await deployFixture();

      const trx = starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 5000,
        },
        {
          wallet: taxRecipient2.address,
          name: "Tax Recipient 2",
          taxBase: 3000,
        },
      ]);

      await expect(trx).to.be.revertedWith(
        "invalid total tax base for tax recipients"
      );
    });
  });

  describe("Get Tax", function () {
    it("should get buy tax", async function () {
      const { starx, admin, user1, exchangePool1 } = await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);
      const buyTax = await starx.getTax(
        exchangePool1.address,
        user1.address,
        parseUnits("10000", "wei")
      );
      expect(buyTax).to.equal(parseUnits("1000", "wei"));
    });

    it("should get sell tax", async function () {
      const { starx, admin, user1, exchangePool1 } = await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);
      const sellTax = await starx.getTax(
        user1.address,
        exchangePool1.address,
        parseUnits("5000", "wei")
      );
      expect(sellTax).to.equal(parseUnits("500", "wei"));
    });

    it("should get 0 tax on exempted address", async function () {
      const { starx, admin, taxController, user1, exchangePool1 } =
        await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);
      await starx.connect(taxController).taxExempt(user1.address, true);
      const taxSell = await starx.getTax(
        user1.address,
        exchangePool1.address,
        parseUnits("10000", "wei")
      );
      expect(taxSell).to.equal(0);

      const taxBuy = await starx.getTax(
        exchangePool1.address,
        user1.address,
        parseUnits("10000", "wei")
      );
      expect(taxBuy).to.equal(0);
    });

    it("should get 0 tax on user to user transaction", async function () {
      const { starx, user1, user2 } = await deployFixture();

      const tax = await starx.getTax(
        user1.address,
        user2.address,
        parseUnits("10000", "wei")
      );
      expect(tax).to.equal(0);
    });

    it("should get 0 tax on pool to pool transaction", async function () {
      const { starx, admin, exchangePool1, exchangePool2 } =
        await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);
      await starx.connect(admin).addExchangePool(exchangePool2.address);

      const tax = await starx.getTax(
        exchangePool1.address,
        exchangePool2.address,
        parseUnits("10000", "wei")
      );
      expect(tax).to.equal(0);
    });
  });

  describe("Permit", function () {
    it("should permit", async function () {
      const { starx, user1, operator } = await deployFixture();

      const domainSeparator = {
        name: "STARX",
        version: "1",
        chainId: 31337,
        verifyingContract: await starx.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const deadline = Math.floor(new Date().getTime() / 1000) + 3600;
      const value = {
        owner: user1.address,
        spender: operator.address,
        value: parseUnits("100", "wei"),
        nonce: await starx.nonces(user1.address),
        deadline,
      };

      const signature = await user1.signTypedData(
        domainSeparator,
        types,
        value
      );

      const initialAllowance = await starx.allowance(
        user1.address,
        operator.address
      );

      const { r, s, v } = ethers.Signature.from(signature);
      expect(initialAllowance).to.equal(0);

      await starx
        .connect(operator)
        .permit(
          user1.address,
          operator.address,
          parseUnits("100", "wei"),
          deadline,
          v,
          r,
          s
        );

      const afterAllowance = await starx.allowance(
        user1.address,
        operator.address
      );
      expect(afterAllowance).to.equal(parseUnits("100", "wei"));
    });

    it("should not permit - wrong signer", async function () {
      const { starx, user1, operator, user2 } = await deployFixture();

      const domainSeparator = {
        name: "STARX",
        version: "1",
        chainId: 31337,
        verifyingContract: await starx.getAddress(),
      };

      const types = {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      };

      const deadline = Math.floor(new Date().getTime() / 1000) + 3600;
      const value = {
        owner: user1.address,
        spender: operator.address,
        value: parseUnits("100", "wei"),
        nonce: await starx.nonces(user1.address),
        deadline,
      };

      const signature = await user2.signTypedData(
        domainSeparator,
        types,
        value
      );
      const { r, s, v } = ethers.Signature.from(signature);
      const trx = starx
        .connect(operator)
        .permit(
          user1.address,
          operator.address,
          parseUnits("100", "wei"),
          deadline,
          v,
          r,
          s
        );
      await expect(trx).to.be.revertedWith("ERC2612: Invalid Signer");
    });
  });

  describe("Non-Taxed Transfer", function () {
    it("should not transfer - blacklisted", async function () {
      const { starx, blacklister, user1, user2, initialHolder } =
        await deployFixture();

      await starx.connect(blacklister).setBlacklistStatus(user1.address, true);
      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("10000", "wei"));

      const trx = starx
        .connect(user1)
        .transfer(user2.address, parseUnits("10000", "wei"));
      await expect(trx).to.be.revertedWith("BEP20: Blacklisted");
    });

    it("should transfer - user to user", async function () {
      const { starx, user1, user2, initialHolder } = await deployFixture();

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("10000", "wei"));
      await starx
        .connect(user1)
        .transfer(user2.address, parseUnits("10000", "wei"));

      const balance = await starx.balanceOf(user2.address);
      expect(balance).to.equal(parseUnits("10000", "wei"));
    });

    it("should transfer - tax exempt", async function () {
      const {
        starx,
        admin,
        taxController,
        user1,
        exchangePool1,
        initialHolder,
      } = await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);
      await starx.connect(taxController).taxExempt(user1.address, true);

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("10000", "wei"));

      await starx
        .connect(user1)
        .transfer(exchangePool1.address, parseUnits("10000", "wei"));
      const balance = await starx.balanceOf(exchangePool1.address);
      expect(balance).to.equal(parseUnits("10000", "wei"));
    });
  });

  describe("Taxed Transfer", function () {
    it("should not transfer - blacklisted", async function () {
      const { starx, blacklister, user1, exchangePool1, initialHolder } =
        await deployFixture();

      await starx.connect(blacklister).setBlacklistStatus(user1.address, true);
      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("10000", "wei"));

      const trx = starx
        .connect(user1)
        .transfer(exchangePool1.address, parseUnits("10000", "wei"));

      await expect(trx).to.be.revertedWith("BEP20: Blacklisted");
    });

    it("should transfer - sell single tax recipient", async function () {
      const {
        starx,
        admin,
        user1,
        exchangePool1,
        taxRecipient1,
        initialHolder,
      } = await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);

      await starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("10000", "wei"));

      await starx
        .connect(user1)
        .transfer(exchangePool1.address, parseUnits("10000", "wei"));

      const exchangeBalance = await starx.balanceOf(exchangePool1.address);
      const taxBalance = await starx.balanceOf(taxRecipient1.address);

      expect(exchangeBalance).to.equal(
        parseUnits("10000", "wei") - parseUnits("1000", "wei")
      );
      expect(taxBalance).to.equal(parseUnits("1000", "wei"));
    });

    it("should transfer - sell multiple tax recipients", async function () {
      const {
        starx,
        admin,
        user1,
        exchangePool1,
        taxRecipient1,
        taxRecipient2,
        taxRecipient3,
        initialHolder,
      } = await deployFixture();

      await starx.connect(admin).addExchangePool(exchangePool1.address);

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("10000", "wei"));

      await starx
        .connect(user1)
        .transfer(exchangePool1.address, parseUnits("10000", "wei"));

      const exchangeBalance = await starx.balanceOf(exchangePool1.address);
      const taxBalance1 = await starx.balanceOf(taxRecipient1.address);
      const taxBalance2 = await starx.balanceOf(taxRecipient2.address);
      const taxBalance3 = await starx.balanceOf(taxRecipient3.address);

      expect(exchangeBalance).to.equal(parseUnits("9000", "wei"));
      expect(taxBalance1).to.equal(parseUnits("300", "wei"));
      expect(taxBalance2).to.equal(parseUnits("300", "wei"));
      expect(taxBalance3).to.equal(parseUnits("400", "wei"));
    });

    it("should transfer - buy single tax recipients", async function () {
      const {
        starx,
        admin,
        user1,
        exchangePool1,
        taxRecipient1,
        initialHolder,
      } = await deployFixture();

      await starx.connect(admin).setTaxRecipient([
        {
          wallet: taxRecipient1.address,
          name: "Tax Recipient 1",
          taxBase: 10000,
        },
      ]);

      await starx
        .connect(initialHolder)
        .transfer(exchangePool1.address, parseUnits("10000", "wei"));

      await starx.connect(admin).addExchangePool(exchangePool1.address);

      await starx
        .connect(exchangePool1)
        .transfer(user1.address, parseUnits("10000", "wei"));

      const user1Balance = await starx.balanceOf(user1.address);
      const taxBalance = await starx.balanceOf(taxRecipient1.address);

      const totalTax = await getTax(starx, exchangePool1, user1, "10000");
      expect(user1Balance).to.equal(parseUnits("10000", "wei") - totalTax);
      expect(taxBalance).to.equal(totalTax);
    });

    it("should transfer - buy multiple tax recipient", async function () {
      const {
        starx,
        admin,
        user1,
        exchangePool1,
        taxRecipient1,
        taxRecipient2,
        taxRecipient3,
        initialHolder,
      } = await deployFixture();

      await starx
        .connect(initialHolder)
        .transfer(exchangePool1.address, parseUnits("10000", "wei"));

      await starx.connect(admin).addExchangePool(exchangePool1.address);

      await starx
        .connect(exchangePool1)
        .transfer(user1.address, parseUnits("10000", "wei"));

      const user1Balance = await starx.balanceOf(user1.address);
      const taxRecipient1Balance = await starx.balanceOf(taxRecipient1.address);
      const taxRecipient2Balance = await starx.balanceOf(taxRecipient2.address);
      const taxRecipient3Balance = await starx.balanceOf(taxRecipient3.address);

      const totalTax = await getTax(starx, exchangePool1, user1, "10000");
      expect(user1Balance).to.equal(parseUnits("10000", "wei") - totalTax);
      expect(taxRecipient1Balance).to.equal(parseUnits("300", "wei"));
      expect(taxRecipient2Balance).to.equal(parseUnits("300", "wei"));
      expect(taxRecipient3Balance).to.equal(parseUnits("400", "wei"));
    });
  });

  describe("Permitted Non-Taxed Transfer", function () {
    it("should not transfer - blacklisted", async function () {
      const { starx, blacklister, user1, operator, user2, initialHolder } =
        await deployFixture();

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("1000", "wei"));

      await starx.connect(blacklister).setBlacklistStatus(user1.address, true);

      const { deadline, v, r, s } = await createPermit(
        starx,
        user1,
        user2,
        "1000"
      );
      await starx
        .connect(operator)
        .permit(
          user1.address,
          user2.address,
          parseUnits("1000", "wei"),
          deadline,
          v,
          r,
          s
        );

      const trx = starx
        .connect(operator)
        .transferFrom(user1.address, user2.address, parseUnits("1000", "wei"));
      await expect(trx).to.be.revertedWith("BEP20: Blacklisted");
    });

    it("should not transfer - insufficient allowance", async function () {
      const { starx, user1, operator, user2, initialHolder } =
        await deployFixture();

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("1000", "wei"));

      const { deadline, v, r, s } = await createPermit(
        starx,
        user1,
        user2,
        "1000"
      );

      await starx
        .connect(operator)
        .permit(
          user1.address,
          user2.address,
          parseUnits("1000", "wei"),
          deadline,
          v,
          r,
          s
        );

      const trx = starx
        .connect(operator)
        .transferFrom(user1.address, user2.address, parseUnits("1000", "wei"));
      await expect(trx).to.be.revertedWith(
        "BEP20: Transfer amount exceeds allowance."
      );
    });

    it("should transfer", async function () {
      const { starx, user1, operator, user2, initialHolder } =
        await deployFixture();

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("10000", "wei"));

      const { deadline, v, r, s } = await createPermit(
        starx,
        user1,
        operator,
        "1000"
      );

      await starx
        .connect(operator)
        .permit(
          user1.address,
          operator,
          parseUnits("1000", "wei"),
          deadline,
          v,
          r,
          s
        );

      await starx
        .connect(operator)
        .transferFrom(user1.address, user2.address, parseUnits("1000", "wei"));
      const balance = await starx.balanceOf(user2.address);
      expect(balance).to.equal(parseUnits("1000", "wei"));
    });
  });

  describe("ERC20", function () {
    it("should approve", async function () {
      const { starx, user1, operator, initialHolder } = await deployFixture();

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("1000", "wei"));

      await starx
        .connect(user1)
        .approve(operator.address, parseUnits("100", "wei"));

      const allowance = await starx.allowance(user1.address, operator.address);
      expect(allowance).to.equal(parseUnits("100", "wei"));
    });

    it("should burn", async function () {
      const { starx, burner, initialHolder } = await deployFixture();

      const totalSupply = await starx.totalSupply();

      await starx
        .connect(initialHolder)
        .transfer(burner.address, parseUnits("1000", "wei"));

      await starx.connect(burner).burn(parseUnits("100", "wei"));

      const balance = await starx.balanceOf(burner.address);
      expect(balance).to.equal(
        parseUnits("1000", "wei") - parseUnits("100", "wei")
      );

      const supplyAfter = await starx.totalSupply();
      expect(supplyAfter).to.equal(totalSupply - parseUnits("100", "wei"));
    });

    it("should revert on burn without role", async function () {
      const { starx, initialHolder, user1 } = await deployFixture();

      await starx
        .connect(initialHolder)
        .transfer(user1.address, parseUnits("1000", "wei"));

      await expect(starx.connect(user1).burn(parseUnits("100", "wei")))
        .to.be.revertedWithCustomError(
          starx,
          "AccessControlUnauthorizedAccount"
        )
        .withArgs(user1.address, await starx.BURNER_ROLE());
    });

    it("should withdraw native token", async function () {
      const { starx, owner, admin, user1 } = await deployFixture();

      const balance = await ethers.provider.getBalance(owner.address);

      await user1.sendTransaction({
        to: await starx.getAddress(),
        value: parseEther("1.0"),
      });

      await starx
        .connect(admin)
        .withdraw(
          "0x0000000000000000000000000000000000000000",
          parseEther("1")
        );

      const balanceAfter = await ethers.provider.getBalance(owner.address);
      expect(balanceAfter).to.be.equal(balance + parseEther("1.0"));
    });

    it("should withdraw other token", async function () {
      const { starx, owner, admin, user1, initialHolder, taxRecipient1 } =
        await deployFixture();

      // other token deployment
      const starxp = await ethers.deployContract("STARX", [
        admin.address,
        initialHolder.address,
        [
          {
            wallet: taxRecipient1.address,
            name: "Tax Recipient 1",
            taxBase: 10000,
          },
        ],
      ]);

      await starxp
        .connect(initialHolder)
        .transfer(await starx.getAddress(), parseUnits("1000", "wei"));

      const balance = await starxp.balanceOf(await starx.getAddress());

      await starx
        .connect(admin)
        .withdraw(await starxp.getAddress(), parseUnits("1000", "wei"));

      expect(await starxp.balanceOf(await starx.getAddress())).to.be.equal(
        balance - parseUnits("1000", "wei")
      );
    });
  });
});
