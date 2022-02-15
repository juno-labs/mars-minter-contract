import { Gas, NEAR } from "near-units";
import { NearAccount, ONE_NEAR, Workspace } from "near-workspaces-ava";
import {
  BalanceDelta,
  deploy,
  mint,
  nftTokensForOwner,
  printBalance,
  totalCost,
} from "./beyondUtils";

function getRoyalties({ root, person_b, person_c }) {
  return {
    accounts: {
      [root.accountId]: 10,
      [person_b.accountId]: 20,
      [person_c.accountId]: 70,
    },
    percent: 20,
  };
}

function delpoyParas(
  root: NearAccount,
  owner_id: NearAccount,
  treasury_id: NearAccount,
  approved_nft_contract_ids: NearAccount[]
): Promise<NearAccount> {
  return root.createAndDeploy("paras-market", `${__dirname}/paras.wasm`, {
    method: "new",
    args: {
      owner_id,
      treasury_id,

      approved_nft_contract_ids,
    },
  });
}

const runner = Workspace.init(
  { initialBalance: NEAR.parse("15 N").toString() },
  async ({ root }) => {
    const owner_id = root;
    await printBalance(console, root);
    const person_b = await root.createAccount("person_b");
    const person_a = await root.createAccount("person_a");
    const person_c = await root.createAccount("person_c");
    const royalties = getRoyalties({ root, person_b, person_c });
    const beyond = await deploy(root, "beyond", { royalties });
    const token_id = await mint(beyond, person_a, await totalCost(beyond, 1));

    const paras = await delpoyParas(root, root, root, [beyond]);

    await person_a.call(
      paras,
      "storage_deposit",
      {},
      {
        attachedDeposit: ONE_NEAR,
      }
    );
    const msg = JSON.stringify({
      market_type: "sale",
      price: ONE_NEAR.toString(),
      ft_token_ids: "near",
    });
    await person_a.call(
      beyond,
      "nft_approve",
      {
        token_id,
        account_id: paras,
        msg,
      },
      {
        attachedDeposit: ONE_NEAR,
      }
    );
    return { beyond, paras, person_c, person_a, person_b };
  }
);

runner.test(
  "buy one",
  async (t, { root, beyond, paras, person_a, person_c, person_b }) => {
    const person_a2 = await root.createAccount("person_a2");
    const ids = await nftTokensForOwner(person_a, beyond);
    t.is(ids.length, 1);
    const token_id = ids[0].token_id;
    t.log(
      await paras.view("get_market_data", {
        nft_contract_id: beyond.accountId,
        token_id,
      })
    );

    const balance = await root.availableBalance();
    const PersonCBalance = await person_c.availableBalance();
    const person_aDelta = await BalanceDelta.create(person_a, t);
    const person_a2Delta = await BalanceDelta.create(person_a2, t);

    t.log("Before person_a2 buys from person_a");
    await printBalance(t, person_a);
    await printBalance(t, person_a2);
    await printBalance(t, person_c);
    await printBalance(t, person_b);
    await printBalance(t, root);

    const res = await person_a2.call_raw(
      paras,
      "buy",
      {
        nft_contract_id: beyond,
        token_id,
      },
      {
        gas: Gas.parse("100 Tgas"),
        attachedDeposit: ONE_NEAR,
      }
    );

    t.log("After person_a2 buys from person_a");
    await printBalance(t, person_a);
    await printBalance(t, person_a2);
    await printBalance(t, person_c);
    await printBalance(t, person_b);
    await printBalance(t, root);

    await person_a2Delta.isLessOrEqual(NEAR.from(ONE_NEAR.neg()));
    await person_aDelta.isGreaterOrEqual(NEAR.parse("750 mN"));

    t.assert(
      res.logsContain("EVENT_JSON"),
      `Expected EVENT_JSON got ${res.logs}`
    );
    t.log(res.logs);
    t.log(await nftTokensForOwner(person_a2, beyond));
    const newBalance = await root.availableBalance();
    t.assert(newBalance.gt(balance));
    t.log(newBalance.sub(balance).toHuman());
    const newEveBalance = await person_c.availableBalance();
    t.assert(newEveBalance.gt(PersonCBalance));
    t.log(newEveBalance.sub(PersonCBalance).toHuman());
  }
);
