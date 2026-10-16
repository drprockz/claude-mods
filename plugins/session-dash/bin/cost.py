#!/usr/bin/env python3
"""API-equivalent Claude Code cost from transcript token usage.

  cost.py session <transcript base path>   this session + its subagents
  cost.py month                            this calendar month (IST), all projects
  cost.py month-cache                      same, written atomically to
                                           ~/.claude/session-dash/month-cost.json

Prices are list API rates ($/MTok, see prices.py). Each request is counted once
(message id + request id).
On a subscription this is what the usage would cost at API prices, not a bill.
"""
import json, sys, glob, os, re
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))
# The status line runs this with python3 -I, which leaves the script's own
# folder off sys.path; prices.py sits beside it.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prices import cost
def scan(files, since=None):
    seen = set(); total = 0.0; by = {}; unpriced = set(); n = 0
    for f in files:
        try: fh = open(f)
        except OSError: continue
        for line in fh:
            if '"usage"' not in line: continue
            try: e = json.loads(line)
            except ValueError: continue
            m = e.get('message') or {}
            u = m.get('usage'); mid = m.get('id')
            if not u or not mid or m.get('model') in (None, '<synthetic>'): continue
            key = (mid, e.get('requestId'))
            if key in seen: continue
            if since:
                ts = e.get('timestamp')
                if not ts or datetime.fromisoformat(ts.replace('Z', '+00:00')) < since: continue
            seen.add(key); n += 1
            c, miss = cost(u, m.get('model'))
            if miss: unpriced.add(miss)
            total += c; by[m.get('model')] = by.get(m.get('model'), 0) + c
    return total, by, n, unpriced
mode = sys.argv[1]
if mode == 'session':
    base = sys.argv[2]
    files = [base + '.jsonl'] + glob.glob(base + '/subagents/**/*.jsonl', recursive=True)
    t, by, n, un = scan(files)
    print(json.dumps({'usd': round(t, 4), 'requests': n, 'files': len(files), 'by_model': {k: round(v, 4) for k, v in by.items()}, 'unpriced': sorted(un)}))
else:
    now = datetime.now(IST); start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    files = [f for f in glob.glob(os.path.expanduser('~/.claude/projects/**/*.jsonl'), recursive=True)
             if os.path.getmtime(f) >= start.timestamp()]
    t, by, n, un = scan(files, since=start)
    body = json.dumps({'month': start.strftime('%Y-%m'), 'usd': round(t, 2), 'requests': n, 'files': len(files),
                      'by_model': {k: round(v, 2) for k, v in sorted(by.items(), key=lambda x: -x[1])}, 'unpriced': sorted(un),
                      'computed_at': now.isoformat(timespec='seconds')})
    if mode == 'month-cache':
        out = os.path.expanduser('~/.claude/session-dash/month-cost.json')
        tmp = out + '.%d.tmp' % os.getpid()
        with open(tmp, 'w') as fh: fh.write(body)
        os.replace(tmp, out)
    else:
        print(body)
