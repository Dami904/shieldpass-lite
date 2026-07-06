import { Web3Auth, WEB3AUTH_NETWORK, type WEB3AUTH_NETWORK_TYPE } from "@web3auth/modal";

// Web3Auth here is an IDENTITY AGGREGATOR ONLY — it gives Lite "add any login provider at will"
// (Google, Facebook, Discord, X, email OTP, etc, all configured from the Web3Auth dashboard with
// no per-provider OAuth app of our own) by getting the user through a social/email login and
// handing back a verified email. It does NOT hold or generate the wallet key: ShieldPass's smart
// wallet is a Soroban contract signed by a WebAuthn passkey (secp256r1), a different key scheme
// than Web3Auth's own chain-key management, so Web3Auth's wallet features are unused on purpose.
// After this resolves, the existing passkey-creation + smart-wallet-deploy flow in
// OnboardingPage.tsx runs completely unchanged.
//
// Required env: VITE_WEB3AUTH_CLIENT_ID (from the Web3Auth dashboard project).
let web3authInstance: Web3Auth | null = null;

function getWeb3Auth(): Web3Auth {
  if (web3authInstance) return web3authInstance;
  const clientId = import.meta.env.VITE_WEB3AUTH_CLIENT_ID as string;
  if (!clientId) throw new Error("VITE_WEB3AUTH_CLIENT_ID is not configured.");

  web3authInstance = new Web3Auth({
    clientId,
    web3AuthNetwork: (import.meta.env.VITE_WEB3AUTH_NETWORK as WEB3AUTH_NETWORK_TYPE) || WEB3AUTH_NETWORK.SAPPHIRE_MAINNET,
    // We never sign anything with Web3Auth's own provider — this chain config is only present
    // because the SDK requires one. It's inert as far as ShieldPass's Stellar wallet is concerned.
    chains: [{
      chainNamespace: "eip155", chainId: "0x1", rpcTarget: "https://rpc.ankr.com/eth",
      displayName: "Ethereum Mainnet", blockExplorerUrl: "https://etherscan.io",
      ticker: "ETH", tickerName: "Ethereum", logo: "https://images.web3auth.io/eth.svg",
    }],
    defaultChainId: "0x1",
  });
  return web3authInstance;
}

/**
 * Opens the Web3Auth modal (Google, Facebook, Discord, X, email OTP, etc — whatever providers
 * are enabled on the Web3Auth dashboard project). Resolves with the provider-verified email once
 * the backend has checked the idToken's signature — never trust the client-reported email alone,
 * since it's the key the backend upserts User rows on.
 */
export async function loginWithWeb3Auth(
  verifyIdToken: (idToken: string) => Promise<{ email: string; providerSub?: string }>,
): Promise<{ email: string; providerSub?: string }> {
  const web3auth = getWeb3Auth();
  await web3auth.init();
  if (!web3auth.connected) await web3auth.connect();

  const { idToken } = await web3auth.getAuthTokenInfo();
  if (!idToken) throw new Error("Social login did not return an identity token.");

  const verified = await verifyIdToken(idToken);

  // Best-effort: leave the social session open only long enough to get the idToken. ShieldPass's
  // real session is the passkey-backed smart wallet set up right after this in OnboardingPage.
  await web3auth.logout().catch(() => {});

  return verified;
}
