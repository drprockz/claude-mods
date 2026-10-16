"""List API prices ($/MTok) and token cost, shared by cost.py and history.py.

Cache writes are 1.25x (5m) / 2x (1h) input; reads as listed. On a
subscription this is what the usage would cost at API prices, not a bill.
"""
# $/MTok: input, output, cache read.
PRICE = {
  'opus-5-5': (4, 20, 0.20), 'opus-5': (5, 25, 0.50), 'opus-4-8': (5, 25, 0.50), 'opus-4-7': (5, 25, 0.50),
  'opus-4-6': (5, 25, 0.50), 'opus-4-5': (5, 25, 0.50), 'sonnet-5-5': (2, 10, 0.20), 'sonnet-5': (2, 10, 0.20),
  'sonnet-4-6': (3, 15, 0.30), 'haiku-5-5': (0.10, 0.50, 0.01), 'haiku-4-5': (1, 5, 0.10),
  'fable-5-1': (10, 50, 0.25), 'fable-5': (10, 50, 1.0),
}
def price(model):
    for k in sorted(PRICE, key=len, reverse=True):
        if k in (model or ''): return PRICE[k]
    return None
def cost_parts(u, model):
    """({'in','out','cr','cw'} in $, None), or ({}, model) when the model has no price."""
    p = price(model)
    if not p: return {}, model
    i, o, r = p
    cc = u.get('cache_creation') or {}
    w5 = cc.get('ephemeral_5m_input_tokens'); w1 = cc.get('ephemeral_1h_input_tokens')
    if w5 is None and w1 is None: w5, w1 = u.get('cache_creation_input_tokens', 0), 0
    return {'in': (u.get('input_tokens', 0) or 0) * i / 1e6, 'out': (u.get('output_tokens', 0) or 0) * o / 1e6,
            'cr': (u.get('cache_read_input_tokens', 0) or 0) * r / 1e6,
            'cw': ((w5 or 0) * i * 1.25 + (w1 or 0) * i * 2) / 1e6}, None
def cost(u, model):
    parts, miss = cost_parts(u, model)
    return (sum(parts.values()) if parts else 0.0), miss
