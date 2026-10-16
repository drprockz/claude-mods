#!/usr/bin/env python3
"""All-time Claude Code usage, rolled up per transcript file.

  history.py index     update ~/.claude/session-dash/history-index.json, print a one-line JSON report
  history.py rebuild   the same from scratch

Each transcript file becomes one rollup: models with tokens and est. $,
tools, skills, subagents, MCP calls, slash commands, branches, versions and
messages per day. Claude Code deletes old transcripts, so a rollup whose
file is gone is kept, marked pruned: the index doubles as the archive.
Dedup is per file (streamed replies repeat their message id); the data has
no call repeated across files.
"""
import json, os, re, sys, time
from collections import Counter
from datetime import datetime
# Run with python3 -I by the mod, which leaves this folder off sys.path.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prices import cost_parts

V = 1
WORKTREE = re.compile(r'^(.*?)/\.?worktrees/([^/]+)')
COMMAND = re.compile(r'<command-name>/?([^<\s]+)</command-name>')


def claude_dir():
    return os.environ.get('SESSION_DASH_CLAUDE_DIR') or os.path.expanduser('~/.claude')


def index_path():
    return os.path.join(claude_dir(), 'session-dash', 'history-index.json')


def split_worktree(cwd):
    m = WORKTREE.match(cwd or '')
    return (m.group(1), m.group(2)) if m else (cwd, None)


def folder_project(path):
    # "-home-me-STS-app" -> "/home/me/STS/app"; lossy for names holding '-', only a fallback
    rel = os.path.relpath(path, os.path.join(claude_dir(), 'projects'))
    return '/' + rel.split(os.sep)[0].lstrip('-').replace('-', '/')


def bump(d, k, n=1):
    d[k] = d.get(k, 0) + n


def text_of(e):
    c = e.get('content')
    if isinstance(c, str): return c
    m = e.get('message')
    c = m.get('content') if isinstance(m, dict) else None
    if isinstance(c, str): return c
    if isinstance(c, list):
        return ' '.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
    return ''


def add_tool(r, b):
    name = b.get('name') or '?'
    i = b.get('input') if isinstance(b.get('input'), dict) else {}
    if name.startswith('mcp__'):
        parts = name.split('__', 2)
        bump(r['mcp'].setdefault(parts[1] if len(parts) > 1 else '?', {}), parts[2] if len(parts) > 2 else '?')
        bump(r['tools'], 'mcp')
        return
    bump(r['tools'], name)
    if name == 'Skill' and i.get('skill'): bump(r['skills'], str(i['skill']))
    if name in ('Agent', 'Task'): bump(r['agents'], str(i.get('subagent_type') or 'general-purpose'))


def parse(path):
    name = os.path.basename(path)
    agent_file = name.startswith('agent-') or 'subagents' in path.split(os.sep)
    r = {'sessionId': None, 'agentFile': agent_file, 'pruned': False, 'cwd': None, 'project': None, 'worktree': None,
         'start': None, 'end': None, 'startDay': None, 'startHour': None, 'versions': {}, 'branches': {},
         'models': {}, 'tools': {}, 'skills': {}, 'agents': {}, 'mcp': {}, 'commands': {}, 'days': {},
         'unpriced': [], 'skipped': 0}
    calls, msgs, tools, cwds, unpriced = set(), set(), set(), Counter(), set()
    with open(path, errors='replace') as fh:
        for line in fh:
            if '"timestamp"' not in line: continue
            try: e = json.loads(line)
            except ValueError: r['skipped'] += 1; continue
            if not isinstance(e, dict) or not isinstance(e.get('timestamp'), str): continue
            try: t = datetime.fromisoformat(e['timestamp'].replace('Z', '+00:00')).astimezone()
            except ValueError: r['skipped'] += 1; continue
            iso = t.isoformat(timespec='seconds')
            if r['start'] is None or iso < r['start']:
                r['start'], r['startDay'], r['startHour'] = iso, t.date().isoformat(), t.hour
            if r['end'] is None or iso > r['end']: r['end'] = iso
            if not r['sessionId'] and isinstance(e.get('sessionId'), str): r['sessionId'] = e['sessionId']
            if isinstance(e.get('cwd'), str) and e['cwd']: cwds[e['cwd']] += 1
            if e.get('version'): bump(r['versions'], str(e['version']))
            if e.get('gitBranch') and e['gitBranch'] != 'HEAD': bump(r['branches'], str(e['gitBranch']))
            typ = e.get('type'); uuid = e.get('uuid')
            if typ in ('user', 'system') and uuid not in msgs:
                for c in COMMAND.findall(text_of(e)): bump(r['commands'], c)
            if typ not in ('user', 'assistant'):
                if uuid: msgs.add(uuid)
                continue
            day = r['days'].setdefault(t.date().isoformat(), {'m': 0, 'c': 0})
            if uuid and uuid not in msgs: msgs.add(uuid); day['m'] += 1
            m = e.get('message')
            if typ != 'assistant' or not isinstance(m, dict): continue
            for b in m.get('content') or []:
                if isinstance(b, dict) and b.get('type') == 'tool_use' and b.get('id') and b['id'] not in tools:
                    tools.add(b['id']); add_tool(r, b)
            u, mid, model = m.get('usage'), m.get('id'), m.get('model')
            if not u or not mid or model in (None, '<synthetic>'): continue
            key = (mid, e.get('requestId'))
            if key in calls: continue
            calls.add(key)
            parts, miss = cost_parts(u, model)
            if miss: unpriced.add(miss)
            usd = sum(parts.values())
            s = r['models'].setdefault(model, {'calls': 0, 'in': 0, 'out': 0, 'cr': 0, 'cw': 0, 'usd': 0.0,
                                               'usdParts': {'in': 0.0, 'out': 0.0, 'cr': 0.0, 'cw': 0.0},
                                               'agentCalls': 0, 'agentUsd': 0.0})
            s['calls'] += 1
            s['in'] += u.get('input_tokens', 0) or 0
            s['out'] += u.get('output_tokens', 0) or 0
            s['cr'] += u.get('cache_read_input_tokens', 0) or 0
            s['cw'] += u.get('cache_creation_input_tokens', 0) or 0
            s['usd'] += usd
            for k, v in parts.items(): s['usdParts'][k] += v
            if agent_file or e.get('isSidechain'): s['agentCalls'] += 1; s['agentUsd'] += usd
            day['c'] += 1
    r['sessionId'] = r['sessionId'] or os.path.splitext(name)[0]
    r['cwd'] = cwds.most_common(1)[0][0] if cwds else None
    r['project'], r['worktree'] = split_worktree(r['cwd']) if r['cwd'] else (folder_project(path), None)
    r['unpriced'] = sorted(unpriced)
    r['days'] = {k: v for k, v in r['days'].items() if v['m'] or v['c']}
    for s in r['models'].values():
        s['usd'] = round(s['usd'], 6); s['agentUsd'] = round(s['agentUsd'], 6)
        s['usdParts'] = {k: round(v, 6) for k, v in s['usdParts'].items()}
    return r
