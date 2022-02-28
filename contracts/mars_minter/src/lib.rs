use near_contract_standards::non_fungible_token::{
    metadata::{NFTContractMetadata, TokenMetadata, NFT_METADATA_SPEC},
    refund_deposit_to_account, NearEvent, NonFungibleToken, Token, TokenId,
};
use near_sdk::{
    borsh::{self, BorshDeserialize, BorshSerialize},
    collections::{LazyOption, LookupMap},
    env,
    json_types::Base64VecU8,
    near_bindgen, require, AccountId, Balance, BorshStorageKey, PanicOnDefault, Promise,
    PromiseOrValue,
};

pub mod payout;
mod raffle;

use payout::*;
use raffle::Raffle;

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize, PanicOnDefault)]
pub struct Contract {
    pub(crate) tokens: NonFungibleToken,
    metadata: LazyOption<NFTContractMetadata>,
    raffle: Raffle,
    pending_tokens: u32,
    mint_start_epoch: u64,
    premint_start_epoch: u64,
    pub base_cost: Balance,
    royalties: LazyOption<Royalties>,
    initial_royalties: LazyOption<Royalties>,
    whitelist: LookupMap<AccountId, u32>,
}

#[derive(BorshSerialize, BorshStorageKey)]
enum StorageKey {
    NonFungibleToken,
    Metadata,
    TokenMetadata,
    Enumeration,
    Approval,
    Ids,
    Royalties,
    InitialRoyalties,
    Whitelist,
}

#[near_bindgen]
impl Contract {
    #[init]
    pub fn new_default_meta(
        owner_id: AccountId,
        name: String,
        symbol: String,
        uri: String,
        size: u32,
        base_cost: U128,
        mint_start_epoch: Option<u64>,
        premint_start_epoch: Option<u64>,
        icon: Option<String>,
        spec: Option<String>,
        reference: Option<String>,
        reference_hash: Option<Base64VecU8>,
        royalties: Option<Royalties>,
        initial_royalties: Option<Royalties>,
    ) -> Self {
        royalties.as_ref().map(|r| r.validate());
        initial_royalties.as_ref().map(|r| r.validate());
        Self::new(
            owner_id.clone(),
            NFTContractMetadata {
                spec: spec.unwrap_or(NFT_METADATA_SPEC.to_string()),
                name,
                symbol,
                icon,
                base_uri: Some(uri),
                reference,
                reference_hash,
            },
            size,
            base_cost,
            mint_start_epoch.unwrap_or(0),
            premint_start_epoch.unwrap_or(0),
            royalties,
            initial_royalties,
        )
    }

    #[init]
    pub fn new(
        owner_id: AccountId,
        metadata: NFTContractMetadata,
        size: u32,
        base_cost: U128,
        mint_start_epoch: u64,
        premint_start_epoch: u64,
        royalties: Option<Royalties>,
        initial_royalties: Option<Royalties>,
    ) -> Self {
        metadata.assert_valid();
        Self {
            tokens: NonFungibleToken::new(
                StorageKey::NonFungibleToken,
                owner_id,
                Some(StorageKey::TokenMetadata),
                Some(StorageKey::Enumeration),
                Some(StorageKey::Approval),
            ),
            metadata: LazyOption::new(StorageKey::Metadata, Some(&metadata)),
            raffle: Raffle::new(StorageKey::Ids, size as u64),
            pending_tokens: 0,
            mint_start_epoch: mint_start_epoch,
            premint_start_epoch: premint_start_epoch,
            base_cost: base_cost.0,
            royalties: LazyOption::new(StorageKey::Royalties, royalties.as_ref()),
            initial_royalties: LazyOption::new(
                StorageKey::InitialRoyalties,
                initial_royalties.as_ref(),
            ),
            whitelist: LookupMap::new(StorageKey::Whitelist),
        }
    }

    pub fn add_whitelist_account(&mut self, account_id: AccountId, allowance: u32) {
        self.assert_owner();
        self.whitelist.insert(&account_id, &allowance);
    }

    pub fn whitelisted(&self, account_id: AccountId) -> bool {
        self.whitelist.contains_key(&account_id)
    }

    pub fn get_wl_allowance(&self, account_id: AccountId) -> u32 {
        self.get_whitelist_allowance(&account_id)
    }

    #[payable]
    pub fn nft_mint(
        &mut self,
        _token_id: TokenId,
        _token_owner_id: AccountId,
        _token_metadata: TokenMetadata,
    ) -> Token {
        self.nft_mint_one()
    }

    #[payable]
    pub fn nft_mint_one(&mut self) -> Token {
        self.nft_mint_many(1)[0].clone()
    }

    #[payable]
    pub fn nft_mint_many(&mut self, num: u32) -> Vec<Token> {
        let owner_id = &env::signer_account_id();
        let num = self.assert_can_mint(owner_id, num);
        let tokens = self.nft_mint_many_unguarded(num, owner_id);
        if self.is_premint() {
            self.use_whitelist_allowance(owner_id, num);
        }
        tokens
    }

    fn nft_mint_many_unguarded(&mut self, num: u32, owner_id: &AccountId) -> Vec<Token> {
        let initial_storage_usage = env::storage_usage();

        let tokens: Vec<Token> = (0..num)
            .map(|_| self.draw_and_mint(owner_id.clone(), None))
            .collect();

        let storage_used = env::storage_usage() - initial_storage_usage;
        if let Some(royalties) = self.initial_royalties.get() {
            let storage_cost = env::storage_byte_cost() * storage_used as Balance;
            let left_over_funds = env::attached_deposit() - storage_cost;
            royalties.send_funds(left_over_funds, &self.tokens.owner_id);
        } else {
            refund_deposit_to_account(storage_used, self.tokens.owner_id.clone());
        }
        log_mint(
            owner_id.as_str(),
            tokens.iter().map(|t| t.token_id.to_string()).collect(),
        );
        tokens
    }

    pub fn total_cost(&self, num: u32) -> U128 {
        (num as Balance * self.cost_per_token().0).into()
    }

    pub fn cost_per_token(&self) -> U128 {
        (self.base_cost + self.token_storage_cost().0).into()
    }

    pub fn token_storage_cost(&self) -> U128 {
        (env::storage_byte_cost() * self.tokens.extra_storage_in_bytes_per_token as Balance).into()
    }
    pub fn tokens_left(&self) -> u32 {
        self.raffle.len() as u32 - self.pending_tokens
    }

    pub fn get_mint_start_epoch(&self) -> u64 {
        self.mint_start_epoch
    }

    pub fn nft_metadata(&self) -> NFTContractMetadata {
        self.metadata.get().unwrap()
    }

    pub fn transfer_ownership(&mut self, new_owner: AccountId) {
        self.assert_owner();
        env::log_str(&format!(
            "{} transfers ownership to {}",
            self.tokens.owner_id, new_owner
        ));
        self.tokens.owner_id = new_owner;
    }

    pub fn update_mint_start_epoch(&mut self, mint_start_epoch: u64) {
        self.assert_owner();
        env::log_str(&format!(
            "updating {} to {}",
            self.mint_start_epoch, mint_start_epoch
        ));
        self.mint_start_epoch = mint_start_epoch;
    }

    pub fn update_premint_start_epoch(&mut self, premint_start_epoch: u64) {
        self.assert_owner();
        env::log_str(&format!(
            "updating {} to {}",
            self.premint_start_epoch, premint_start_epoch
        ));
        self.premint_start_epoch = premint_start_epoch;
    }

    pub fn update_base_cost(&mut self, base_cost: Balance) {
        self.assert_owner();
        env::log_str(&format!("updating {} to {}", self.base_cost, base_cost));
        self.base_cost = base_cost;
    }

    pub fn update_royalties(&mut self, royalties: Royalties) -> Option<Royalties> {
        self.assert_owner();
        royalties.validate();
        self.royalties.replace(&royalties)
    }

    fn assert_deposit(&self, num: u32) {
        require!(
            env::attached_deposit() >= self.total_cost(num).0,
            "Not enough attached deposit to buy"
        );
    }

    fn assert_can_mint(&self, account_id: &AccountId, num: u32) -> u32 {
        if !self.is_owner(account_id) {
            if self.premint_start_epoch * 1000000000 > env::block_timestamp() {
                env::panic_str("Mint has not started yet")
            }
            if self.mint_start_epoch * 1000000000 > env::block_timestamp() {
                let allowance = self.get_whitelist_allowance(&account_id);
                require!(
                    allowance >= num,
                    format!("Cannot mint {} when allowance is {}", num, allowance)
                );
            }
        }
        require!(self.tokens_left() >= num, "No NFTs left to mint");
        self.assert_deposit(num);
        num
    }

    fn assert_owner(&self) {
        require!(self.signer_is_owner(), "Method is private to owner")
    }

    fn signer_is_owner(&self) -> bool {
        self.is_owner(&env::signer_account_id())
    }

    fn is_owner(&self, minter: &AccountId) -> bool {
        minter.as_str() == self.tokens.owner_id.as_str()
    }

    fn is_premint(&self) -> bool {
        let mut premint: bool = false;
        if self.premint_start_epoch * 1000000000 <= env::block_timestamp() {
            if self.mint_start_epoch * 1000000000 > env::block_timestamp() {
                premint = true;
            }
        }
        premint
    }

    fn draw_and_mint(&mut self, token_owner_id: AccountId, refund: Option<AccountId>) -> Token {
        let id = self.raffle.draw();
        self.internal_mint(id.to_string(), token_owner_id, refund)
    }

    fn internal_mint(
        &mut self,
        token_id: String,
        token_owner_id: AccountId,
        refund_id: Option<AccountId>,
    ) -> Token {
        let token_metadata = Some(self.create_metadata(&token_id));
        self.tokens
            .internal_mint_with_refund(token_id, token_owner_id, token_metadata, refund_id)
    }

    fn create_metadata(&mut self, token_id: &String) -> TokenMetadata {
        let media = Some(format!("{}.png", token_id));
        let reference = Some(format!("{}.json", token_id));
        let title = Some(format!("{}", token_id));
        TokenMetadata {
            title,
            description: None,
            media,
            media_hash: None,
            copies: None,
            issued_at: Some(env::block_timestamp().to_string()),
            expires_at: None,
            starts_at: None,
            updated_at: None,
            extra: None,
            reference,
            reference_hash: None,
        }
    }

    fn use_whitelist_allowance(&mut self, account_id: &AccountId, num: u32) {
        let allowance = self.get_whitelist_allowance(account_id);
        let new_allowance = allowance - num;
        self.whitelist.insert(&account_id, &new_allowance);
    }

    fn get_whitelist_allowance(&self, account_id: &AccountId) -> u32 {
        self.whitelist
            .get(account_id)
            .unwrap_or_else(|| panic!("Account not on whitelist"))
    }
}

near_contract_standards::impl_non_fungible_token_core!(Contract, tokens);
near_contract_standards::impl_non_fungible_token_approval!(Contract, tokens);
near_contract_standards::impl_non_fungible_token_enumeration!(Contract, tokens);

fn log_mint(owner_id: &str, token_ids: Vec<String>) {
    NearEvent::log_nft_mint(owner_id.to_string(), token_ids, None);
}
