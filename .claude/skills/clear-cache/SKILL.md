---
name: clear-cache
description: Clear the BonkFun verification cache to force re-verification
disable-model-invocation: true
allowed-tools: Bash
---

# Clear BonkFun Cache

Clear the Vercel KV cache to force re-verification of all tokens on next page load.

**Warning:** This will cause the next page load to take ~4 minutes while all tokens are re-verified.

## Command:
```bash
curl -X POST "$KV_REST_API_URL/del/bonkfun:verified_tokens" \
  -H "Authorization: Bearer $KV_REST_API_TOKEN"
```

## After clearing:
1. The next page load will trigger full verification
2. Progress will be logged in the console
3. Results will be saved back to KV when complete
