---
name: verify-token
description: Verify if a token address is a BonkFun token by checking on-chain data
allowed-tools: Bash, Read
---

# Verify BonkFun Token

When given a token mint address, verify if it's a genuine BonkFun token.

## Steps:
1. Use Helius API to fetch the token's transaction history
2. Check for BonkFun program involvement:
   - LaunchLab: `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj`
   - Graduate: `boop8hVGQGqehUK2iVEMEnMrL5RbjywRzHKBmBE7ry4`
   - Platform Config: `FfYek5vEz23cMkWsdJwG2oa6EphsvXSHrGpdALN4g6W1`

## Command to check:
```bash
curl -s "https://api.helius.xyz/v0/addresses/$TOKEN_ADDRESS/transactions?api-key=$HELIUS_API_KEY&limit=10"
```

Report:
- Whether it's a BonkFun token
- Which program was found
- The transaction signature as proof
