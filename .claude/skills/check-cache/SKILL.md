---
name: check-cache
description: Check the BonkFun verification cache status in Vercel KV
allowed-tools: Bash, Read
---

# Check BonkFun Cache Status

Check the current state of the BonkFun token verification cache in Vercel KV.

## What to check:
1. Fetch the cached token list from KV
2. Report how many tokens are cached
3. Show when the cache was last updated

## Command:
```bash
curl -s "$KV_REST_API_URL/get/bonkfun:verified_tokens" \
  -H "Authorization: Bearer $KV_REST_API_TOKEN"
```

## Report:
- Number of verified tokens in cache
- Cache age (if available)
- Sample of cached token addresses
