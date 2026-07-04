export interface ComplianceAttestation {
  merkleRoot: string;
  secretSalt: string;
}

export interface P2POffer {
  id: string;
  sellerId: string;
  sellerAddress: string;
  assetType: 'USDC' | 'XLM' | 'NGNC' | string;
  cryptoAmount: string;
  nairaRate: string;
  status: 'open' | 'locked' | 'completed';
  createdAt: string;
}

export interface Balance {
  assetCode: string;
  balance: string;
}

export interface TradeHistoryItem {
  id: string;
  role: 'buyer' | 'seller';
  cryptoAmount: string;
  assetType: string;
  nairaAmount: string;
  status: 'open' | 'locked' | 'completed';
}

export interface BankDetails {
  bankName: string;
  accountName: string;
  accountNumber: string;
}

export interface Trade {
  id: string;
  status: string;
  assetType: string;
  cryptoAmount: string;
  nairaRate: string;
  expectedAmount: string;
  sellerWallet: string;
  buyerWallet: string | null;
  virtualAccountRef: string | null;
  releaseTxHash: string | null;
  payoutRef: string | null;
}

export interface HistoryItem extends Trade {
  role: 'buyer' | 'seller';
}

// ── Trustless Instant Swap ──
export interface BankAccount {
  id: string;
  bankName: string;
  bankCode?: string;      // Lenco's 6-digit code (used for name enquiry + payout)
  accountNumber: string;
  accountName: string;
  isDefault: boolean;
}

export interface Quote {
  tokenAddress: string;
  assetCode: string;
  tokenLabel: string;
  cryptoAmount: number;
  rate: number;
  nairaAmount: number;
  source: string;
  updatedAt: string;
  requireBvn: boolean;
  tier2ThresholdNaira: number;
}

export interface SwapRecord {
  id: string;
  tokenAddress: string;
  assetCode: string;
  tokenLabel: string;
  cryptoAmount: number;
  nairaAmount: number;
  cryptoAmountUnits: string;
  nairaAmountKobo: string;
  quoteRateNaira: number;
  quoteSource: string;
  quotedAt: string | null;
  status: string;
  swapId: string | null;
  txHash: string | null;
  createdAt: string;
}
