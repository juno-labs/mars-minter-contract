import { Gas, NEAR } from "near-units";
import { NearAccount, ONE_NEAR } from "near-workspaces-ava";
import { join } from "path";

const RUST_BIN_FOLDER = ["target", "wasm32-unknown-unknown", "release"];

export const createNewAccount = async (
  t: any,
  root: NearAccount,
  accountName: string,
  initialBalance: string = "15 N"
) => {
  const account = await root.createAccount(accountName, {
    initialBalance: NEAR.parse(initialBalance).toString(),
  });
  const accountAddress = account.accountId;
  const accountBalance = await account.balance();
  const accountBalanceHuman = accountBalance.available.toHuman();
  t.log(`${accountAddress} created with balance ${accountBalanceHuman}`);
  return account;
};

export const printBalance = async (t, user: NearAccount) => {
  const userAddress = user.accountId;
  const userBalance = await user.balance();
  const userBalanceHuman = userBalance.available.toHuman();
  t.log(`${userAddress} has ${userBalanceHuman}`);
};

export async function userMintsNFTs(
  t,
  user: NearAccount,
  beyond,
  num,
  shouldFail: boolean = false,
  printRootCost: boolean = false
) {
  const numPriorHoldings = (await nftTokensForOwner(user, beyond)).length;
  const method = num == 1 ? "nft_mint_one" : "nft_mint_many";
  let args = num == 1 ? {} : { num };
  const cost = await totalCost(beyond, num);

  if (printRootCost) {
    t.log("Cost for root to mint", (await totalCost(beyond, num)).toHuman());
  }

  t.log(
    `${user.accountId} is minting: ${num} tokens costing ` + cost.toHuman()
  );
  const userBalanceBefore = (await user.balance()).available.toHuman();
  t.log(`Balance Before: ${userBalanceBefore}`);
  try {
    const res = await user.call_raw(beyond, method, args, {
      attachedDeposit: cost,
      gas: MINT_ONE_GAS,
    });
    t.true(
      res.succeeded,
      [res.Failure, ...res.promiseErrorMessages].join("\n")
    );
    t.is(
      num,
      (await nftTokensForOwner(user, beyond)).length - numPriorHoldings
    );
  } catch (error) {
    t.assert(shouldFail);
    t.is(numPriorHoldings, (await nftTokensForOwner(user, beyond)).length);
  }
  const userBalanceAfter = (await user.balance()).available.toHuman();
  t.log(`Balance After: ${userBalanceAfter}`);
}

export class NEARDelta {
  static readonly ZERO_NEAR = NEAR.from(0);
  constructor(public readonly amount: NEAR) {}

  toHuman(): string {
    if (this.isZero()) {
      return `0 N`;
    }
    const absAmount = this.amount.abs();
    return `${this.amount.isNeg() ? "-" : ""}${absAmount.toHuman()}`;
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  gt(by = NEARDelta.ZERO_NEAR): boolean {
    return this.amount.gt(by);
  }

  gte(by = NEARDelta.ZERO_NEAR): boolean {
    return this.amount.gte(by);
  }

  lt(by = NEARDelta.ZERO_NEAR): boolean {
    return this.amount.lt(by);
  }

  lte(by = NEARDelta.ZERO_NEAR): boolean {
    return this.amount.lte(by);
  }
}

export class BalanceDelta {
  private constructor(
    public readonly initial: NEAR,
    public readonly account: NearAccount,
    private t: any
  ) {}

  static async create(account: NearAccount, t): Promise<BalanceDelta> {
    return new BalanceDelta(await account.availableBalance(), account, t);
  }

  async delta(): Promise<NEARDelta> {
    const newBalance = await this.account.availableBalance();
    return new NEARDelta(newBalance.sub(this.initial));
  }

  async isZero(): Promise<void> {
    return this.assert((delta) => delta.isZero(), "zero");
  }

  async isGreater(by?: NEAR): Promise<void> {
    return this.assert((delta) => delta.gt(by), "greater");
  }
  async isGreaterOrEqual(by?: NEAR): Promise<void> {
    return this.assert((delta) => delta.gte(by), "greater or equal");
  }

  async isLess(by?: NEAR): Promise<void> {
    return this.assert((delta) => delta.lt(by), "less");
  }

  async isLessOrEqual(by?: NEAR): Promise<void> {
    return this.assert((delta) => delta.lte(by), "less or equal");
  }

  private async assert(
    fn: (d: NEARDelta) => boolean,
    innerString: string
  ): Promise<void> {
    const delta = await this.delta();
    this.t.assert(
      fn(delta),
      `Account ${
        this.account.accountId
      } expected ${innerString} got: ${delta.toHuman()}`
    );
  }

  async toHuman(): Promise<string> {
    return (await this.delta()).toHuman();
  }

  async log(): Promise<void> {
    this.t.log(`${this.account.accountId} has delta ${await this.toHuman()}`);
  }
}

export async function getDelta<T>(
  t,
  account: NearAccount,
  txns: () => Promise<T>
): Promise<[BalanceDelta, T]> {
  const delta = await BalanceDelta.create(account, t);
  return [delta, await txns()];
}

const binPath = (name: string): string => {
  return join(__dirname, "..", ...RUST_BIN_FOLDER, `${name}.wasm`);
};

export function deploy(
  owner: NearAccount,
  name = "beyond",
  args = {}
): Promise<NearAccount> {
  return owner.createAndDeploy(name, binPath(name), {
    method: "new_default_meta",
    args: {
      owner_id: owner,
      name: "BEYOND NFT",
      symbol: "BEYOND",
      uri: "https://bafybeidq7nu5pxsiy2cext6qtxxygpifhunxco25mtrabfge2rf6lxdax4.ipfs.dweb.link/",
      size: 100,
      base_cost: NEAR.parse("1 N"),
      is_premint_over: true,
      ...args,
    },
  });
}

export async function nftTokensForOwner(
  root,
  beyond,
  from_index = null,
  limit = null
) {
  return beyond.view("nft_tokens_for_owner", {
    account_id: root,
    from_index,
    limit,
  });
}

export async function costPerToken(
  beyond: NearAccount,
  num: number
): Promise<NEAR> {
  return NEAR.from(await beyond.view("cost_per_token", { num }));
}

export async function totalCost(
  beyond: NearAccount,
  num: number
): Promise<NEAR> {
  return NEAR.from(await beyond.view("total_cost", { num }));
}

export async function tokenStorageCost(beyond: NearAccount): Promise<NEAR> {
  return NEAR.from(await beyond.view("token_storage_cost"));
}

export const MINT_ONE_GAS = Gas.parse("300 TGas");

export async function getTokens(
  contract: NearAccount,
  account_id: NearAccount
): Promise<any[]> {
  return contract.view("nft_tokens_for_owner", { account_id });
}

export async function mint(
  beyond: NearAccount,
  root: NearAccount,
  attachedDeposit = ONE_NEAR
): Promise<string> {
  let res = await root.call_raw(
    beyond,
    "nft_mint_one",
    {},
    {
      attachedDeposit,
    }
  );
  return res.parseResult<any>().token_id;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
