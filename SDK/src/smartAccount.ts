import { contract } from '@stellar/stellar-sdk';
import { SmartAccountKit } from 'smart-account-kit';

export interface PasskeyWalletConfig {
  rpcUrl: string;
  networkPassphrase: string;
  /** OZ smart-account wasm hash — a fresh account instance is deployed per user from this. */
  accountWasmHash: string;
  /** Deployed secp256r1 / WebAuthn verifier contract (validates passkey signatures on-chain). */
  webauthnVerifierAddress: string;
  /** Backend relayer proxy URL for gasless submission. If unset, the kit submits via RPC. */
  relayerUrl?: string;
}

export interface ConnectedWallet { credentialId: string; contractId: string }
export interface InvokeResult { hash: string; result: unknown }

/**
 * WebAuthn caps the user handle (`user.id`) at 64 bytes. smart-account-kit derives it from
 * `${user}:${Date.now()}:${Math.random()}`, so a long email overflows the limit and the OS
 * passkey prompt throws "User handle exceeds 64 bytes". Bound `user` to leave headroom for the
 * kit's timestamp+random suffix (~34 bytes worst case). The handle is throwaway — ShieldPass keys
 * users by email in its own backend — so truncating only affects the cosmetic passkey label.
 */
function boundUserHandle(user: string, maxBytes = 28): string {
  const enc = new TextEncoder();
  if (enc.encode(user).length <= maxBytes) return user;
  let out = '';
  for (const ch of user) {
    if (enc.encode(out + ch).length > maxBytes) break;
    out += ch;
  }
  return out;
}

/**
 * Browser-only wrapper over OpenZeppelin's smart-account-kit — the audited successor to
 * passkey-kit. WebAuthn requires a DOM, so this must NEVER be imported on the backend (and it is
 * intentionally NOT re-exported from the SDK index — import it directly via
 * `@shieldpass/sdk/dist/smartAccount`). Provides: deploy a new smart account, reconnect an existing one,
 * and invoke a contract method authorized by the device passkey (gaslessly via the relayer proxy).
 */
export class SmartAccountWalletClient {
  private kit: SmartAccountKit;
  private cfg: PasskeyWalletConfig;

  constructor(cfg: PasskeyWalletConfig) {
    this.cfg = cfg;
    this.kit = new SmartAccountKit({
      rpcUrl: cfg.rpcUrl,
      networkPassphrase: cfg.networkPassphrase,
      accountWasmHash: cfg.accountWasmHash,
      webauthnVerifierAddress: cfg.webauthnVerifierAddress,
      relayerUrl: cfg.relayerUrl,
      // storage defaults to IndexedDB in the browser.
    });
  }

  /** Create a passkey + deploy its smart account. Auto-submits the deploy via the relayer proxy. */
  async createWallet(app: string, user: string): Promise<ConnectedWallet> {
    const res = await this.kit.createWallet(app, boundUserHandle(user), {
      autoSubmit: true,
      // Pin the authenticator so every user gets the SAME passkey experience: the device's
      // built-in platform authenticator (Windows Hello / Touch ID / Face ID — which itself
      // falls back to the OS PIN when there's no biometric). `platform` excludes roaming
      // authenticators, so the browser never demands an external USB security key. `required`
      // userVerification forces the biometric/PIN gesture; `required` residentKey keeps the
      // credential discoverable for new-device login (connectWallet discovery prompt).
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
      },
    });
    if (res.submitResult && !res.submitResult.success) {
      throw new Error(res.submitResult.error || 'Smart account deploy failed.');
    }
    return { credentialId: res.credentialId, contractId: res.contractId };
  }

  /**
   * Reconnect to a wallet. With a stored credentialId/contractId it binds directly; with neither it
   * runs a WebAuthn discovery prompt (this is how login works on a NEW device with no stored id).
   */
  async connectWallet(credentialId?: string, contractId?: string): Promise<ConnectedWallet> {
    const res = await this.kit.connectWallet({
      ...(credentialId ? { credentialId } : {}),
      ...(contractId ? { contractId } : {}),
      prompt: !credentialId && !contractId,
    });
    if (!res) throw new Error('No smart account wallet to connect.');
    return { credentialId: res.credentialId, contractId: res.contractId };
  }

  /**
   * Invoke a contract method through the connected smart account, signing the auth entries with the
   * device passkey and submitting gaslessly via the relayer proxy. Returns the tx hash and the
   * simulated return value (e.g. the new swap id from `lock_swap`).
   *
   * `args` keys must match the contract function's parameter names, with values in the contract
   * client's native form (Address as a string, i128 as a bigint, BytesN<32> as a 32-byte Buffer).
   */
  /**
   * Transfer tokens from the connected smart wallet to a recipient.
   * Uses the kit's native XDR-level transfer path instead of contract.Client.from(),
   * which fails on native SACs (XLM, etc.) because they have no uploadable Wasm.
   *
   * @param tokenContract - SAC address for the token
   * @param recipient     - Destination address (G... or C...)
   * @param amountStroops - Amount in the token's base unit (1 XLM = 10_000_000 stroops)
   */
  async transferToken(
    tokenContract: string,
    recipient: string,
    amountStroops: bigint,
  ): Promise<InvokeResult> {
    // kit.transfer expects amount in whole-token units (e.g. 10.5 for 10.5 XLM)
    const result = await this.kit.transfer(tokenContract, recipient, Number(amountStroops) / 10_000_000);
    if (!result.success) throw new Error(result.error || 'Transfer failed.');
    return { hash: result.hash, result: undefined };
  }

  async invoke(contractId: string, method: string, args: Record<string, unknown>): Promise<InvokeResult> {
    const client = await contract.Client.from({
      contractId,
      rpcUrl: this.cfg.rpcUrl,
      networkPassphrase: this.cfg.networkPassphrase,
      publicKey: this.kit.deployerPublicKey,
    });
    const methods = client as unknown as Record<string, (a: Record<string, unknown>) => Promise<contract.AssembledTransaction<unknown>>>;
    if (typeof methods[method] !== 'function') {
      throw new Error(`Contract ${contractId} has no method "${method}".`);
    }
    const assembled = await methods[method](args);
    const simulated = assembled.result; // parsed return value from simulation (before submit)
    const txResult = await this.kit.signAndSubmit(assembled);
    if (!txResult.success) throw new Error(txResult.error || 'Smart account transaction failed.');
    return { hash: txResult.hash, result: simulated };
  }

  /** Disconnect and clear the stored session. */
  async disconnect(): Promise<void> {
    await this.kit.disconnect();
  }

  /** The fee-paying source account the kit uses (sponsored by the relayer when configured). */
  get deployerPublicKey(): string {
    return this.kit.deployerPublicKey;
  }
}
