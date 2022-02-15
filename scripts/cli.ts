import { program } from "commander";
import dayjs from "dayjs";
import assert from "assert";
import fs from "fs";

const { keyStores, connect, transactions, utils } = require("near-api-js");
const path = require("path");
const homedir = require("os").homedir();

const CREDENTIALS_DIR = ".near-credentials";

program.version("0.0.2");

const EMPTY_WASM_PATH = "./scripts/empty.wasm";
const BEYOND_WASM_PATH = "./scripts/beyond.wasm";

const nodeUrlMap = {
  mainnet: "https://rpc.mainnet.near.org",
  testnet: "https://rpc.testnet.near.org",
};

const getAccount = async (env, accountId) => {
  const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
  const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

  const config = {
    keyStore,
    networkId: env,
    nodeUrl: nodeUrlMap[env],
  };

  const near = await connect(config);
  const account = await near.account(accountId);
  return account;
};

const deployContract = async (env, accountId, wasmPath) => {
  const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
  const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

  const config = {
    keyStore,
    networkId: env,
    nodeUrl: nodeUrlMap[env],
  };

  const near = await connect(config);
  const account = await near.account(accountId);
  const result = await account.deployContract(fs.readFileSync(wasmPath));
  console.log(result);
};

const deployAndInitializeContract = async (env, accountId, wasmPath) => {
  const credentialsPath = path.join(homedir, CREDENTIALS_DIR);
  const keyStore = new keyStores.UnencryptedFileSystemKeyStore(credentialsPath);

  const config = {
    keyStore,
    networkId: env,
    nodeUrl: nodeUrlMap[env],
  };

  const near = await connect(config);
  const account = await near.account(accountId);

  // Prepare variables
  const royalties = {
    accounts: {
      [accountId]: 100,
    },
    percent: 20,
  };

  const initial_royalties = {
    accounts: {
      [accountId]: 100,
    },
    percent: 100,
  };

  const epochNext060sec = dayjs().unix() + 60;
  const epochNext300sec = dayjs().unix() + 300;

  const accountState = await account.state();

  const { code_hash: codeHash } = accountState;

  const emptyCodeHashList = ["11111111111111111111111111111111"];

  const initialData = {
    owner_id: accountId,
    name: "NDN Testing",
    symbol: "NDNT",
    uri: "https://bafybeidq7nu5pxsiy2cext6qtxxygpifhunxco25mtrabfge2rf6lxdax4.ipfs.dweb.link/",
    description:
      "Dragon Nation is an exclusive collection of 3,000 Dragon NFTs on the NEAR blockchain.",
    size: 3000,
    base_cost: utils.format.parseNearAmount("0.1"),
    royalties,
    initial_royalties,
    premint_start_epoch: epochNext060sec,
    mint_start_epoch: epochNext300sec,
  };

  if (emptyCodeHashList.includes(codeHash)) {
    const result = await account.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        transactions.deployContract(fs.readFileSync(wasmPath)),
        transactions.functionCall(
          "new_default_meta",
          initialData,
          "200000000000000"
        ),
      ],
    });
    console.log("Contract is deployed 🚀");
  } else {
    console.log("Contract is already deployed!!");
  }
};

const getCurrentWhitelistAllowance = async (
  adminAccount,
  contractId,
  accountId
) => {
  let currentAllowance = 0;
  try {
    currentAllowance = await adminAccount.viewFunction(
      contractId,
      "get_wl_allowance",
      {
        account_id: accountId,
      }
    );
  } catch (error) {
    // Error will be thrown for the accounts which are not whitelisted
  }

  return currentAllowance;
};

const whitelistAccount = async (
  adminAccount,
  contractId,
  accountId,
  allowance
) => {
  let currentAllowance = 0;

  currentAllowance = await getCurrentWhitelistAllowance(
    adminAccount,
    contractId,
    accountId
  );

  if (currentAllowance !== allowance) {
    await adminAccount.functionCall({
      contractId,
      methodName: "add_whitelist_account",
      args: { account_id: accountId, allowance },
      gas: "30000000000000",
    });
  } else {
    return;
  }

  currentAllowance = await getCurrentWhitelistAllowance(
    adminAccount,
    contractId,
    accountId
  );

  assert.ok(currentAllowance === allowance);
};

programCommand("deploy_empty_contract").action(async (options) => {
  const { env, accountId } = options;
  await deployContract(env, accountId, EMPTY_WASM_PATH);
  process.exit(0);
});

programCommand("deploy_beyond_contract").action(async (options) => {
  const { env, accountId } = options;
  await deployAndInitializeContract(env, accountId, BEYOND_WASM_PATH);
  process.exit(0);
});

programCommand("whitelist")
  .requiredOption(
    "-wj, --wl-json <string>",
    "Path of the json file containing addresses with allowance"
  )
  .action(async (options) => {
    const { env, accountId: contractId } = options;
    const wlJson = JSON.parse(fs.readFileSync(options.wlJson, "utf8"));
    const adminAccount = await getAccount(env, contractId);
    const promiseList = Object.keys(wlJson).map(async (nearAddress) => {
      await whitelistAccount(
        adminAccount,
        contractId,
        nearAddress,
        wlJson[nearAddress]
      );
    });
    await Promise.all(promiseList);
    console.log(`Done ✅`);
    process.exit(0);
  });

function programCommand(name: string) {
  return program
    .command(name)
    .option(
      "-e, --env <string>",
      "NEAR cluster env name. One of: mainnet, testnet",
      "testnet"
    )
    .requiredOption("-a, --account-id <string>", "NEAR account ID");
}

program.parse(process.argv);
