import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.4.18",
      },
      {
        version: "0.5.16",
      },
      {
        version: "0.6.6",
      },
      {
        version: "0.8.20",
      },
    ],
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    bscTestnet: {
      url: "https://bsc-testnet-rpc.publicnode.com",
    },
    hardhat: {
      allowUnlimitedContractSize: true,
    },
  },
};

export default config;
