# ShieldPass Integration Guide

Welcome to the ShieldPass Integration Guide! 

ShieldPass is a decentralized **Zero-Knowledge P2P Escrow** platform living on the Stellar blockchain. Because the core escrow logic is deployed as a standalone smart contract, **any application in the world** can connect to it and use its features natively.

You don't need to route traffic through our backend—you can talk directly to the blockchain!

---

## 🚀 Types of Apps That Can Use ShieldPass

Our smart contract is highly composable. Here are a few examples of apps that can integrate the ShieldPass Escrow SDK:

1. **Remittance & Cross-Border Payment Apps:**
   Apps helping users send money from the US/UK to Nigeria can use ShieldPass on the backend to guarantee the final crypto-to-Naira conversion without holding user funds.
2. **E-Commerce & Freelance Platforms:**
   A freelancer platform can use ShieldPass to hold USDC in escrow until the client confirms the freelancer delivered the work.
3. **Telegram Bots & WhatsApp Mini-Apps:**
   A chatbot can allow users to trade crypto via text message by directly interacting with the ShieldPass contract.
4. **Crypto Wallets:**
   Wallets can build a native "Cash Out to Fiat" button directly into their interface by hooking into the ShieldPass smart contract.
5. **Alternative P2P Marketplaces:**
   Other developers can build entirely new UIs (like a Tinder-style swiping app for P2P trading) that uses the ShieldPass contract as its liquidity backbone.

---

## 🛠️ How to Connect to ShieldPass

Connecting to ShieldPass is as simple as installing the standard Stellar SDK in your preferred programming language.

### Prerequisites
- **Network:** Stellar Testnet (`https://soroban-testnet.stellar.org`)
- **Contract ID:** `CA2ELE2XWYFIFHLU45TZREVLY6535FCOVLVHYUISD5YQ6U5OBDP6Y4QU`

### Example 1: Connecting from a Node.js Backend
If you are building a server-side application (like a Telegram bot or a centralized exchange), you can use `@stellar/stellar-sdk` to execute transactions on behalf of your users.

```typescript
import { rpc, Contract, Keypair, Networks, TransactionBuilder, Account, BASE_FEE } from '@stellar/stellar-sdk';

// 1. Connect to Stellar Testnet
const server = new rpc.Server('https://soroban-testnet.stellar.org');

// 2. Load the ShieldPass Escrow Contract
const CONTRACT_ID = 'CA2ELE2XWYFIFHLU45TZREVLY6535FCOVLVHYUISD5YQ6U5OBDP6Y4QU';
const contract = new Contract(CONTRACT_ID);

async function createP2POffer(yourSecretKey) {
  const userKeypair = Keypair.fromSecret(yourSecretKey);
  const accountInfo = await server.getAccount(userKeypair.publicKey());
  const account = new Account(userKeypair.publicKey(), accountInfo.sequenceNumber());

  // 3. Build the Transaction (e.g., calling the 'create_offer' function)
  let tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(contract.call('create_offer'))
    .setTimeout(30)
    .build();

  // 4. Simulate, Assemble, Sign, and Submit to Stellar
  const simulatedTx = await server.simulateTransaction(tx);
  tx = rpc.assembleTransaction(tx, simulatedTx).build();
  tx.sign(userKeypair);
  
  const response = await server.sendTransaction(tx);
  console.log('Successfully interacted with ShieldPass! Tx Hash:', response.hash);
}
```

### Example 2: Connecting from a Frontend (React / Next.js)
If you are building a web app, you don't even need secret keys! You can connect the user's Freighter wallet directly to the contract.

```javascript
import { requestAccess, signTransaction } from '@stellar/freighter-api';
import { rpc, Contract, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

async function interactWithShieldPass() {
    // 1. Get user's wallet address via Freighter
    const publicKey = await requestAccess();
    
    // 2. Load the Contract
    const contract = new Contract('CA2ELE2XWYFIFHLU45TZREVLY6535FCOVLVHYUISD5YQ6U5OBDP6Y4QU');
    
    // 3. Build the transaction (similar to the backend approach)
    // ... TransactionBuilder logic ...
    
    // 4. Ask the user's Freighter Wallet to sign the transaction!
    const signedTx = await signTransaction(tx.toXDR(), { network: 'TESTNET' });
    
    // 5. Submit the signed transaction to the Stellar RPC
    // ...
}
```

## Available Smart Contract Functions
When you load the contract, you can call the following core functions:
- `create_offer`: Lock crypto and request Naira.
- `release_crypto`: Release the locked crypto to the buyer's wallet.
- `cancel_offer`: Reclaim the crypto if the trade is aborted.

*For Zero-Knowledge (ZK) compliance, ensure your app verifies users via Noir proofs before allowing them to interact with these functions.*
