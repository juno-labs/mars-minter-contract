import { NEAR } from "near-units";
import { NearAccount, Workspace } from "near-workspaces-ava";
import { deploy, getDelta, mint, totalCost } from "./marsMinterUtils";

if (Workspace.networkIsSandbox()) {
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
      ["person_a", "person_b", "person_c"].map((n) => root.createAccount(n))
    );
  }

  const runner = Workspace.init(
    { initialBalance: NEAR.parse("20 N").toString() },
    async ({ root }) => {
      const [person_a, person_b, person_c] = await subaccounts(root);
      const royalties = createRoyalties({ root, person_a, person_b, person_c });
      const marsMinter = await deploy(root, "mars_minter", {
        royalties,
        initial_royalties: royalties,
        base_cost: NEAR.parse("5 N"),
      });
      return { marsMinter, person_a, person_b, person_c };
    }
  );

  runner.test(
    "Get Payout",
    async (t, { root, marsMinter, person_c, person_b, person_a }) => {
      const balance = NEAR.parse("500 N");
      const cost = await totalCost(marsMinter, 1);
      const token_id = await mint(marsMinter, root, cost);
      const payouts = await marsMinter.view("nft_payout", {
        token_id,
        balance,
        max_len_payout: 10,
      });
      let innerPayout = createRoyalties({
        root,
        person_a,
        person_b,
        person_c,
      }).accounts;
      t.log(innerPayout);
      Object.keys(innerPayout).map(
        (key) =>
          (innerPayout[key] = NEAR.parse(`${innerPayout[key]}N`).toString())
      );
      innerPayout[root.accountId] = balance
        .mul(NEAR.from(4))
        .div(NEAR.from(5))
        .add(NEAR.from(innerPayout[root.accountId]))
        .toString();
      const payout = { payout: innerPayout };
      t.deepEqual(payouts, payout);
    }
  );

  runner.test("Initial Payout", async (t, { root, marsMinter, person_c }) => {
    let charlie = await root.createAccount("charlie");
    const cost = await totalCost(marsMinter, 1);
    let [delta, token_id] = await getDelta(t, person_c, async () =>
      mint(marsMinter, charlie, cost)
    );
    t.log(
      cost.toHuman(),
      await delta.toHuman(),
      cost.mul(NEAR.from(1)).div(NEAR.from(5)).toHuman()
    );
  });
}
