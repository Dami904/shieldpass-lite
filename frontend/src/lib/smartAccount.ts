import type { SmartAccountWalletClient } from '@shieldpass/sdk/dist/smartAccount'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'
const RPC_URL = import.meta.env.VITE_RPC_URL || 'https://soroban-testnet.stellar.org'
const NETWORK = import.meta.env.VITE_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015'
const ACCOUNT_WASM_HASH = import.meta.env.VITE_ACCOUNT_WASM_HASH || ''
const WEBAUTHN_VERIFIER = import.meta.env.VITE_WEBAUTHN_VERIFIER_ADDRESS || ''
const RELAYER_URL = import.meta.env.VITE_RELAYER_URL || `${API_URL}/wallet/relay`

// Dynamic import: the SDK dist files are CommonJS; Vite resolves named exports from them reliably
// via dynamic import (matches how the tester + useZkProof load SDK deep paths).
// Backed by OpenZeppelin smart-account-kit — gasless submission goes through our /wallet/relay proxy.
export async function makeWallet(): Promise<SmartAccountWalletClient> {
  const { SmartAccountWalletClient } = await import('@shieldpass/sdk/dist/smartAccount')
  return new SmartAccountWalletClient({
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK,
    accountWasmHash: ACCOUNT_WASM_HASH,
    webauthnVerifierAddress: WEBAUTHN_VERIFIER,
    relayerUrl: RELAYER_URL,
  })
}
