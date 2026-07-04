export interface BvnResult { ok: boolean; returnedName: string }

// A small fixed roster so the mock "lookup" returns a stable legal name per BVN.
const NAMES = [
  'Joshua Adeleke', 'Aisha Bello', 'Chinedu Okafor', 'Ngozi Eze',
  'Tunde Balogun', 'Fatima Sani', 'Emeka Nwosu', 'Zainab Yusuf',
];

/**
 * Verify a BVN. MOCK for the hackathon: validates the 11-digit format and "returns" the legal
 * name the BVN is registered to (deterministic from the BVN). A real aggregator (Dojah/Prembly)
 * replaces this behind the same signature.
 */
export async function verifyBvn(bvn: string): Promise<BvnResult> {
  if (typeof bvn !== 'string' || !/^\d{11}$/.test(bvn)) return { ok: false, returnedName: '' };
  const returnedName = NAMES[Number(bvn.slice(-4)) % NAMES.length];
  return { ok: true, returnedName };
}
