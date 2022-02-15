import { NEAR } from "near-units";
import { NearAccount, Workspace } from "near-workspaces-ava";
import {
  costPerToken,
  createNewAccount,
  deploy,
  MINT_ONE_GAS,
  nftTokensForOwner,
  printBalance,
  tokenStorageCost,
  totalCost,
  userMintsNFTs,
} from "./beyondUtils";

const base_cost = NEAR.parse("5 N");

function createRoyalties({ root, person_b, person_a, person_c }) {
  return {
    accounts: {
      [root.accountId]: 10,
      [person_b.accountId]: 10,
      [person_a.accountId]: 10,
      [person_c.accountId]: 70,
    },
    percent: 20,
  };
}

function subaccounts(root: NearAccount): Promise<NearAccount[]> {
  return Promise.all(
    ["person_a", "person_b", "person_c"].map((n) =>
      root.createAccount(n, {
        initialBalance: NEAR.parse("200 N").toString(),
      })
    )
  );
}

const runner = Workspace.init(
  { initialBalance: NEAR.parse("50 N").toString() },
  async ({ root }) => {
    console.log(`Is testnet? ${Workspace.networkIsTestnet()}`);

    await printBalance(console, root);

    const [person_a, person_b, person_c] = await subaccounts(root);
    const royalties = createRoyalties({ root, person_a, person_b, person_c });

    await printBalance(console, root);

    const ndnDefaultMetaArgs = {
      name: "Near Dragon Nation",
      symbol: "NFN",
      uri: "https://bafybeidq7nu5pxsiy2cext6qtxxygpifhunxco25mtrabfge2rf6lxdax4.ipfs.dweb.link/",
      size: 100,
      mint_start_epoch: 1642264405,
      base_cost,
      royalties,
    };

    await printBalance(console, person_c);
    const beyond = await deploy(person_c, "beyond", ndnDefaultMetaArgs);
    await printBalance(console, person_c);
    return { beyond, person_b, person_a, person_c };
  }
);

runner.test("can get cost per token", async (t, { beyond }) => {
  const cost = await costPerToken(beyond, 1);
  const storageCost = await tokenStorageCost(beyond);
  t.log(
    "One token costs " +
      cost.toHuman() +
      "to buy and " +
      storageCost.toHuman() +
      " to store"
  );

  t.log(
    `Const per token for 24 is: ${await (
      await costPerToken(beyond, 24)
    ).toHuman()}`
  );

  t.deepEqual(cost.toBigInt(), base_cost.add(storageCost).toBigInt());
  if (cost.toBigInt() > 0) {
    t.assert(cost.gte(await costPerToken(beyond, 24)));
  }
});

async function assertXTokens(t, root: NearAccount, beyond, num) {
  const method = num == 1 ? "nft_mint_one" : "nft_mint_many";
  let args = num == 1 ? {} : { num };
  const cost = await totalCost(beyond, num);

  t.log(`${num} token costs ` + cost.toHuman());
  const res = await root.call_raw(beyond, method, args, {
    attachedDeposit: cost,
    gas: MINT_ONE_GAS,
  });
  t.true(res.succeeded, [res.Failure, ...res.promiseErrorMessages].join("\n"));
  t.is(num, (await nftTokensForOwner(root, beyond)).length);
}

[
  ["one", 1],
  ["two", 2],
  ["five", 5],
  ["ten", 10],
].forEach(async ([num, x]) => {
  runner.test("mint " + num, async (t, { root, beyond }) => {
    await assertXTokens(t, root, beyond, x);
  });
});

[
  ["one", 1],
  ["two", 2],
  ["ten", 10],
].forEach(async ([num, x]) => {
  runner.test("person_b mints " + num, async (t, { person_b, beyond }) => {
    await userMintsNFTs(t, person_b, beyond, x);
  });
});

async function getDetailedViewOfNFT(t, user: NearAccount, beyond) {
  await userMintsNFTs(t, user, beyond, 1);
  const nftList = await nftTokensForOwner(user, beyond);
  const singleNFTMetadata = nftList[0];
  t.log({ singleNFTMetadata });
  const collectionMetadata = await beyond.view("nft_metadata");
  t.log({ collectionMetadata });
}

runner.test("detailed view of NFT ", async (t, { person_a, beyond }) => {
  await getDetailedViewOfNFT(t, person_a, beyond);
});

async function mintingAllNFTs(
  t,
  root: NearAccount,
  deployer: NearAccount,
  beyond
) {
  const whale = await createNewAccount(t, root, "whale", "2000 N");
  for (let i = 0; i < 10; i++) {
    await userMintsNFTs(t, whale, beyond, 10);
    const tokens_left = await beyond.view("tokens_left");
    t.log(`Number of tokens left: ${tokens_left}`);
    await printBalance(t, deployer);
  }

  t.log(
    `Number of Holdings: ${(await nftTokensForOwner(whale, beyond)).length}`
  );

  const method = "nft_mint_one";
  const cost = await totalCost(beyond, 1);

  try {
    await whale.call_raw(
      beyond,
      method,
      {},
      {
        attachedDeposit: cost,
        gas: MINT_ONE_GAS,
      }
    );
    t.assert(false);
  } catch (error) {
    t.assert(true);
  }

  t.is(100, (await nftTokensForOwner(whale, beyond)).length);

  const mintedNFTs = await nftTokensForOwner(whale, beyond);
  const tokenIdList = mintedNFTs
    .map((nft) => nft?.token_id)
    .sort((a, b) => parseInt(a) - parseInt(b));
  t.log({ tokenIdList });
}

runner.test("Try minting all NFTs", async (t, { root, person_c, beyond }) => {
  await mintingAllNFTs(t, root, person_c, beyond);
});
