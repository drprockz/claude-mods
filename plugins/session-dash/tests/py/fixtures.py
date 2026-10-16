import json, os, sys, time

BIN = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'bin'))
sys.path.insert(0, BIN)
os.environ['TZ'] = 'Asia/Kolkata'
time.tzset()

SID = '11111111-1111-1111-1111-111111111111'


def write(path, entries):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as fh:
        for e in entries:
            fh.write(e if isinstance(e, str) else json.dumps(e) + '\n')


def user(uuid, ts, cwd='/home/me/STS/app', text='hi', **kw):
    return {'type': 'user', 'uuid': uuid, 'sessionId': kw.pop('sid', SID), 'timestamp': ts, 'cwd': cwd,
            'version': kw.pop('version', '2.1.301'), 'gitBranch': kw.pop('branch', 'main'),
            'message': {'role': 'user', 'content': text}, **kw}


def reply(uuid, ts, mid, model='claude-opus-5', usage=None, blocks=None, rid='r-' , **kw):
    return {'type': 'assistant', 'uuid': uuid, 'sessionId': kw.pop('sid', SID), 'timestamp': ts,
            'cwd': kw.pop('cwd', '/home/me/STS/app'), 'requestId': rid + mid, 'isSidechain': kw.pop('side', False),
            'message': {'id': mid, 'model': model, 'usage': usage if usage is not None else {'input_tokens': 10, 'output_tokens': 20},
                        'content': blocks or [{'type': 'text', 'text': 'ok'}]}, **kw}


def tool_use(tid, name, **inp):
    return {'type': 'tool_use', 'id': tid, 'name': name, 'input': inp}
