import { ethers } from "hardhat";

async function main() {
  const starx = await ethers.deployContract("STARX", [
    [
      {
        wallet: "0xA1141215Cb4Bd05097299dD7BCd6676f4c1179dE",
        name: "developer",
        taxBase: 7000,
      },
      {
        wallet: "0x1e6FE67e0d392b7dD1BbA57213154121baa2d5dB",
        name: "charity",
        taxBase: 3000,
      },
    ],
  ]);
  await starx.waitForDeployment();

  console.log(`STARX deployed to ${starx.target}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
