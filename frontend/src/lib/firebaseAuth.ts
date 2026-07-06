import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

// Firebase Auth here is an IDENTITY AGGREGATOR ONLY — it gives Lite "add any login provider at
// will" (Google, Facebook, X, email link, etc, all configured from the Firebase console with no
// per-provider OAuth app of our own beyond what each provider requires) by getting the user
// through a social/email login and handing back a verified email. It does NOT hold or generate
// the wallet key: ShieldPass's smart wallet is a Soroban contract signed by a WebAuthn passkey
// (secp256r1), a completely different key scheme, so Firebase's own auth session is discarded
// right after we extract the idToken. After this resolves, the existing passkey-creation +
// smart-wallet-deploy flow in OnboardingPage.tsx runs completely unchanged.
//
// (Previously used Web3Auth for this — replaced after its Sapphire Devnet JWKS endpoint proved
// to not contain the key actually signing tokens, confirmed via cache-busted origin fetches.)
//
// Required env: VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
// VITE_FIREBASE_APP_ID (from the Firebase console's Web app config).
let firebaseApp: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) return firebaseApp;
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY as string;
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string;
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string;
  const appId = import.meta.env.VITE_FIREBASE_APP_ID as string;
  if (!apiKey || !authDomain || !projectId || !appId) {
    throw new Error("Firebase is not configured (VITE_FIREBASE_* env vars missing).");
  }
  firebaseApp = initializeApp({ apiKey, authDomain, projectId, appId });
  return firebaseApp;
}

/**
 * Opens Google's sign-in popup via Firebase Auth. Resolves with the provider-verified email once
 * the backend has checked the idToken's signature — never trust the client-reported email alone,
 * since it's the key the backend upserts User rows on.
 */
export async function loginWithGoogle(
  verifyIdToken: (idToken: string) => Promise<{ email: string; providerSub?: string }>,
): Promise<{ email: string; providerSub?: string }> {
  const auth = getAuth(getFirebaseApp());
  const result = await signInWithPopup(auth, new GoogleAuthProvider());

  const idToken = await result.user.getIdToken();
  if (!idToken) throw new Error("Social login did not return an identity token.");

  const verified = await verifyIdToken(idToken);

  // Best-effort: leave the social session open only long enough to get the idToken. ShieldPass's
  // real session is the passkey-backed smart wallet set up right after this in OnboardingPage.
  await signOut(auth).catch(() => {});

  return verified;
}
