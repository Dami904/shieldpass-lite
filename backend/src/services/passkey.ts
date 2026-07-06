import { ChannelsClient } from '@openzeppelin/relayer-plugin-channels';
import { Keypair, Transaction, TransactionBuilder, Account, Operation, BASE_FEE, rpc, xdr } from '@stellar/stellar-sdk';
import { withAccountLock, waitForLanding } from '@shieldpass/sdk';
import { logger } from '../logger';

const NETWORK = process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wallet deploy: the Soroban resource fee (~108 XLM, mostly persistent-entry rent) exceeds the
 * Channels per-tx fee cap, and it can't be trimmed. So we fee-bump the deploy with our own funded
 * account (STELLAR_RELAYER_SECRET) and submit directly to RPC. The inner tx is untouched — its
 * `kalepail` source (which determines the contract address) and signature stay intact — so the
 * deployed contractId still matches what the client computed.
 */
async function submitDeployViaRelayer(inner: Transaction): Promise<string> {
  const secret = process.env.STELLAR_RELAYER_SECRET;
  if (!secret) throw new Error('STELLAR_RELAYER_SECRET not set — required to fund wallet deploys.');
  const relayer = Keypair.fromSecret(secret);

  // fee-bump base fee per inner op; total = baseFee × (innerOps + 1) ≥ inner.fee. The unused
  // Soroban resource fee is refunded to the fee-bump source, so over-provisioning is safe.
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(relayer, inner.fee, inner, NETWORK);
  feeBump.sign(relayer);

  const server = new rpc.Server(RPC_URL);
  const sent = await server.sendTransaction(feeBump);
  if (sent.status === 'ERROR') {
    throw new Error(`deploy submit rejected: ${JSON.stringify(sent.errorResult ?? sent)}`);
  }

  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 15 && result.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await sleep(1000);
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`deploy did not succeed (status: ${result.status})`);
  }
  return sent.hash;
}

// ──────────────────────────────────────────────────────────────────────────
// smart-account-kit relayer proxy
//
// The kit's RelayerClient POSTs one of two shapes to its `relayerUrl`:
//   • { func, auth } — a base64 host-function XDR + already-passkey-signed auth entries
//                      (gasless invoke, e.g. lock_swap). We rebuild the invoke, assemble,
//                      pay fees from the relayer account, and submit (Channels, RPC fallback).
//   • { xdr }        — a signed transaction needing source-account auth (e.g. the wallet
//                      deploy). We fee-bump it with the relayer (the inner signature is kept).
// It expects a RelayerResponse: { success, hash?, transactionId?, status?, error?, errorCode? }.
// ──────────────────────────────────────────────────────────────────────────

export interface RelayResult {
  success: boolean;
  hash?: string;
  transactionId?: string;
  status?: string;
  error?: string;
  errorCode?: string;
}

/** Submit an assembled+signed Soroban tx gaslessly via Channels, falling back to direct RPC. */
async function submitAssembledTx(tx: Transaction): Promise<string> {
  const baseUrl = process.env.CHANNELS_URL;
  const apiKey = process.env.CHANNELS_API_KEY;
  if (baseUrl && apiKey) {
    try {
      const client = new ChannelsClient({ baseUrl, apiKey });
      const res: any = await client.submitTransaction({ xdr: tx.toXDR() });
      const hashOut = res?.hash ?? res?.txHash ?? res?.id;
      if (hashOut) return String(hashOut);
      throw new Error('Channels returned no hash');
    } catch (channelErr) {
      logger.warn({ err: (channelErr as Error)?.message }, '[relay] Channels submit failed, falling back to RPC');
    }
  }
  // Fallback: the relayer account is the fee source on the assembled tx, so RPC accepts it directly.
  const server = new rpc.Server(RPC_URL);
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') {
    throw new Error(`relay submit rejected: ${JSON.stringify(sent.errorResult ?? sent)}`);
  }
  let result = await server.getTransaction(sent.hash);
  for (let i = 0; i < 15 && result.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await sleep(1000);
    result = await server.getTransaction(sent.hash);
  }
  if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`relay tx did not succeed (status: ${result.status})`);
  }
  return sent.hash;
}

/** Build an invokeHostFunction tx from a base64 func + signed auth entries, then submit it. */
async function submitFuncViaRelayer(funcB64: string, authB64: string[]): Promise<string> {
  const secret = process.env.STELLAR_RELAYER_SECRET;
  if (!secret) throw new Error('STELLAR_RELAYER_SECRET not set — required to source relayed invokes.');
  const source = Keypair.fromSecret(secret);
  const server = new rpc.Server(RPC_URL);

  const hostFunction = xdr.HostFunction.fromXDR(funcB64, 'base64');
  const authEntries = authB64.map((a) => xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64'));
  const op = Operation.invokeHostFunction({ func: hostFunction, auth: authEntries });

  // This tx is sourced from the relayer, so its sequence number collides with the faucet
  // seed / pool funding / wallet seed txs that run during the same onboarding. Serialize on
  // the relayer account and hold through landing so the sequence is consumed before the next
  // relayer tx builds. See accountLock.ts in the SDK.
  return withAccountLock(source.publicKey(), async () => {
    const info = await server.getAccount(source.publicKey());
    const account = new Account(source.publicKey(), info.sequenceNumber());
    let tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK })
      .addOperation(op)
      .setTimeout(30)
      .build();

    const sim = await server.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(sim)) {
      throw new Error(`relay simulation failed: ${JSON.stringify(sim)}`);
    }
    tx = rpc.assembleTransaction(tx, sim).build();
    tx.sign(source);
    const hash = await submitAssembledTx(tx);
    await waitForLanding(server, hash);
    return hash;
  });
}

/** Entry point for POST /wallet/relay — routes the kit's relayer payload to the right submitter. */
export async function relay(body: { func?: string; auth?: string[]; xdr?: string }): Promise<RelayResult> {
  try {
    if (typeof body?.xdr === 'string' && body.xdr.length > 0) {
      const tx = new Transaction(body.xdr, NETWORK);
      // A signed inner tx (deploy / source-account auth) is always fee-bumped by the relayer.
      const hashOut = await submitDeployViaRelayer(tx);
      return { success: true, hash: hashOut, transactionId: hashOut, status: 'SUCCESS' };
    }
    if (typeof body?.func === 'string' && body.func.length > 0) {
      const hashOut = await submitFuncViaRelayer(body.func, Array.isArray(body.auth) ? body.auth : []);
      return { success: true, hash: hashOut, transactionId: hashOut, status: 'SUCCESS' };
    }
    return { success: false, error: 'Provide either { func, auth } or { xdr }.', errorCode: 'INVALID_PARAMS' };
  } catch (e: any) {
    logger.error({ err: e }, '[relay] submission failed');
    return { success: false, error: e?.message || 'relay submission failed', errorCode: 'ONCHAIN_FAILED' };
  }
}
