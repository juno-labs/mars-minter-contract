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
} from "./marsMinterUtils";

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
    const marsMinter = await deploy(
      person_c,
      "mars_minter",
      ndnDefaultMetaArgs
    );
    await printBalance(console, person_c);
    return { marsMinter, person_b, person_a, person_c };
  }
);

runner.test("can get cost per token", async (t, { marsMinter }) => {
  const cost = await costPerToken(marsMinter, 1);
  const storageCost = await tokenStorageCost(marsMinter);
  t.log(
    "One token costs " +
      cost.toHuman() +
      "to buy and " +
      storageCost.toHuman() +
      " to store"
  );

  t.log(
    `Const per token for 24 is: ${await (
      await costPerToken(marsMinter, 24)
    ).toHuman()}`
  );

  t.deepEqual(cost.toBigInt(), base_cost.add(storageCost).toBigInt());
  if (cost.toBigInt() > 0) {
    t.assert(cost.gte(await costPerToken(marsMinter, 24)));
  }
});

async function assertXTokens(t, root: NearAccount, marsMinter, num) {
  const method = num == 1 ? "nft_mint_one" : "nft_mint_many";
  let args = num == 1 ? {} : { num };
  const cost = await totalCost(marsMinter, num);

  t.log(`${num} token costs ` + cost.toHuman());
  const res = await root.call_raw(marsMinter, method, args, {
    attachedDeposit: cost,
    gas: MINT_ONE_GAS,
  });
  t.true(res.succeeded, [res.Failure, ...res.promiseErrorMessages].join("\n"));
  t.is(num, (await nftTokensForOwner(root, marsMinter)).length);
}

[
  ["one", 1],
  ["two", 2],
  ["five", 5],
  ["ten", 10],
].forEach(async ([num, x]) => {
  runner.test("mint " + num, async (t, { root, marsMinter }) => {
    await assertXTokens(t, root, marsMinter, x);
  });
});

[
  ["one", 1],
  ["two", 2],
  ["ten", 10],
].forEach(async ([num, x]) => {
  runner.test("person_b mints " + num, async (t, { person_b, marsMinter }) => {
    await userMintsNFTs(t, person_b, marsMinter, x);
  });
});

async function getDetailedViewOfNFT(t, user: NearAccount, marsMinter) {
  await userMintsNFTs(t, user, marsMinter, 1);
  const nftList = await nftTokensForOwner(user, marsMinter);
  const singleNFTMetadata = nftList[0];
  t.log({ singleNFTMetadata });
  const collectionMetadata = await marsMinter.view("nft_metadata");
  t.log({ collectionMetadata });
}

runner.test("detailed view of NFT ", async (t, { person_a, marsMinter }) => {
  await getDetailedViewOfNFT(t, person_a, marsMinter);
});

async function mintingAllNFTs(
  t,
  root: NearAccount,
  deployer: NearAccount,
  marsMinter
) {
  const whale = await createNewAccount(t, root, "whale", "2000 N");
  for (let i = 0; i < 10; i++) {
    await userMintsNFTs(t, whale, marsMinter, 10);
    const tokens_left = await marsMinter.view("tokens_left");
    t.log(`Number of tokens left: ${tokens_left}`);
    await printBalance(t, deployer);
  }

  t.log(
    `Number of Holdings: ${(await nftTokensForOwner(whale, marsMinter)).length}`
  );

  const method = "nft_mint_one";
  const cost = await totalCost(marsMinter, 1);

  try {
    await whale.call_raw(
      marsMinter,
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

  t.is(100, (await nftTokensForOwner(whale, marsMinter)).length);

  const mintedNFTs = await nftTokensForOwner(whale, marsMinter);
  const tokenIdList = mintedNFTs
    .map((nft) => nft?.token_id)
    .sort((a, b) => parseInt(a) - parseInt(b));
  t.log({ tokenIdList });
}

runner.test(
  "Try minting all NFTs",
  async (t, { root, person_c, marsMinter }) => {
    await mintingAllNFTs(t, root, person_c, marsMinter);
  }
);
