import dayjs from "dayjs";
import { NEAR } from "near-units";
import { Workspace } from "near-workspaces-ava";
import {
  createNewAccount,
  deploy,
  getTokens,
  sleep,
  userMintsNFTs,
} from "./marsMinterUtils";

const sale_price = NEAR.parse("5 N");

const runner = Workspace.init(
  { initialBalance: NEAR.parse("100 N").toString() },
  async ({ root }) => {
    console.log({ rootId: root.accountId });
    const person_b = await createNewAccount(console, root, "person_b", "50 N");
    const epochNext20sec = dayjs().unix() + 20;
    const epochNext60sec = dayjs().unix() + 60;
    const marsMinter = await deploy(root, "mars_minter", {
      is_premint_over: false,
      base_cost: sale_price,
      premint_start_epoch: epochNext20sec,
      mint_start_epoch: epochNext60sec,
    });
    return { marsMinter, person_b };
  }
);

runner.test("premint", async (t, { root, marsMinter, person_b }) => {
  // Owner mints one before presale
  await userMintsNFTs(t, root, marsMinter, 1);
  // PersonB's mint fails before presale
  await userMintsNFTs(t, person_b, marsMinter, 1, true);
  // Wait for presale to start
  const presaleTimer = await sleep(1000 * 20);
  await presaleTimer;
  // PersonB's mint fails during presale since she isn't whitelisted
  await userMintsNFTs(t, person_b, marsMinter, 1, true);
  // Whitelist person_b to mint 2 NFTs
  await root.call(marsMinter, "add_whitelist_account", {
    account_id: person_b,
    allowance: 2,
  });
  // PersonB mint 2 NFTs successfully and mint of 3rd one fails
  await userMintsNFTs(t, person_b, marsMinter, 2, false);
  await userMintsNFTs(t, person_b, marsMinter, 1, true);
  // PersonB waits for the sale to start
  const saleTimer = await sleep(1000 * 40);
  await saleTimer;
  // PersonB mints 3rd NFT successfully
  await userMintsNFTs(t, person_b, marsMinter, 1, false);

  // PersonB finally has 3 NFTs
  const tokens = await getTokens(marsMinter, person_b);
  t.assert(tokens.length == 3);
});
