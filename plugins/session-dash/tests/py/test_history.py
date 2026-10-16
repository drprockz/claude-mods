import json, os, subprocess, sys, tempfile, time, unittest

from fixtures import SID, reply, tool_use, user, write
import history


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['SESSION_DASH_CLAUDE_DIR'] = self.tmp.name
        self.proj = os.path.join(self.tmp.name, 'projects', '-home-me-STS-app')

    def tearDown(self):
        self.tmp.cleanup()

    def parse(self, name, entries):
        path = os.path.join(self.proj, name)
        write(path, entries)
        return history.parse(path)

    def test_streamed_reply_counts_once_and_keeps_its_tools(self):
        r = self.parse(SID + '.jsonl', [
            user('u1', '2026-10-16T06:30:00Z'),
            reply('a1', '2026-10-16T06:30:05Z', 'm1'),
            reply('a2', '2026-10-16T06:30:06Z', 'm1', blocks=[tool_use('t1', 'Bash', command='ls')]),
            reply('a3', '2026-10-16T06:30:07Z', 'm1', blocks=[tool_use('t1', 'Bash', command='ls')]),
        ])
        m = r['models']['claude-opus-5']
        self.assertEqual(m['calls'], 1)
        self.assertEqual((m['in'], m['out']), (10, 20))
        self.assertEqual(r['tools'], {'Bash': 1})
        self.assertEqual(r['days'], {'2026-10-16': {'m': 4, 'c': 1}})
        self.assertEqual((r['startDay'], r['startHour']), ('2026-10-16', 12))  # 06:30Z is 12:00 IST
        self.assertEqual(r['sessionId'], SID)
        self.assertFalse(r['agentFile'])

    def test_synthetic_and_missing_model_are_not_calls(self):
        r = self.parse(SID + '.jsonl', [
            reply('a1', '2026-10-16T06:30:05Z', 'm1', model='<synthetic>'),
            reply('a2', '2026-10-16T06:30:06Z', 'm2', model=None),
        ])
        self.assertEqual(r['models'], {})

    def test_skill_agent_mcp_and_commands(self):
        r = self.parse(SID + '.jsonl', [
            reply('a1', '2026-10-16T06:30:05Z', 'm1', blocks=[
                tool_use('t1', 'Skill', skill='superpowers:brainstorming'),
                tool_use('t2', 'Agent', subagent_type='Explore', description='d', prompt='p'),
                tool_use('t3', 'Task', description='d', prompt='p'),
                tool_use('t4', 'mcp__claude_ai_Atlassian_Rovo__search', q='x'),
            ]),
            {'type': 'system', 'subtype': 'local_command', 'uuid': 's1', 'sessionId': SID,
             'timestamp': '2026-10-16T06:31:00Z', 'content': '<command-name>/afk</command-name>'},
            user('u2', '2026-10-16T06:32:00Z', text='<command-name>/commit-commands:commit</command-name>'),
        ])
        self.assertEqual(r['skills'], {'superpowers:brainstorming': 1})
        self.assertEqual(r['agents'], {'Explore': 1, 'general-purpose': 1})
        self.assertEqual(r['mcp'], {'claude_ai_Atlassian_Rovo': {'search': 1}})
        self.assertEqual(r['tools'], {'Skill': 1, 'Agent': 1, 'Task': 1, 'mcp': 1})
        self.assertEqual(r['commands'], {'afk': 1, 'commit-commands:commit': 1})

    def test_top_level_agent_file_takes_parent_session(self):
        r = self.parse('agent-abc123.jsonl', [
            reply('a1', '2026-10-16T06:30:05Z', 'm1', model='claude-haiku-4-5-20251001', side=True),
        ])
        self.assertTrue(r['agentFile'])
        self.assertEqual(r['sessionId'], SID)
        m = r['models']['claude-haiku-4-5-20251001']
        self.assertEqual((m['calls'], m['agentCalls']), (1, 1))
        self.assertAlmostEqual(m['agentUsd'], m['usd'])

    def test_subagents_folder_file_is_an_agent_file(self):
        r = self.parse(os.path.join(SID, 'subagents', 'agent-x.jsonl'), [
            reply('a1', '2026-10-16T06:30:05Z', 'm1'),
        ])
        self.assertTrue(r['agentFile'])
        self.assertEqual(r['models']['claude-opus-5']['agentCalls'], 1)

    def test_worktree_cwd_folds_into_repo_and_most_frequent_cwd_wins(self):
        wt = '/home/me/STS/backend/.worktrees/fix-1'
        r = self.parse(SID + '.jsonl', [
            user('u1', '2026-10-16T06:30:00Z', cwd='/home/me/STS/backend'),
            user('u2', '2026-10-16T06:31:00Z', cwd=wt),
            user('u3', '2026-10-16T06:32:00Z', cwd=wt),
        ])
        self.assertEqual((r['cwd'], r['project'], r['worktree']), (wt, '/home/me/STS/backend', 'fix-1'))

    def test_no_cwd_falls_back_to_folder_name(self):
        e = reply('a1', '2026-10-16T06:30:05Z', 'm1')
        del e['cwd']
        r = self.parse(SID + '.jsonl', [e])
        self.assertEqual(r['project'], '/home/me/STS/app')

    def test_bad_line_is_skipped_and_counted(self):
        r = self.parse(SID + '.jsonl', ['{"timestamp": "2026-10-16T06:30:00Z", oops\n', user('u1', '2026-10-16T06:30:00Z')])
        self.assertEqual(r['skipped'], 1)
        self.assertEqual(r['days']['2026-10-16']['m'], 1)

    def test_unpriced_model_has_tokens_and_no_cost(self):
        r = self.parse(SID + '.jsonl', [reply('a1', '2026-10-16T06:30:05Z', 'm1', model='claude-mystery-1')])
        m = r['models']['claude-mystery-1']
        self.assertEqual((m['calls'], m['usd']), (1, 0))
        self.assertEqual(r['unpriced'], ['claude-mystery-1'])

    def test_cost_parts_are_kept_per_model(self):
        usage = {'input_tokens': 0, 'output_tokens': 0, 'cache_read_input_tokens': 1_000_000}
        r = self.parse(SID + '.jsonl', [reply('a1', '2026-10-16T06:30:05Z', 'm1', usage=usage)])
        m = r['models']['claude-opus-5']
        self.assertAlmostEqual(m['usdParts']['cr'], 0.5)
        self.assertAlmostEqual(m['usd'], 0.5)
        self.assertEqual(m['cr'], 1_000_000)

    def test_head_branch_is_ignored_and_versions_counted(self):
        r = self.parse(SID + '.jsonl', [user('u1', '2026-10-16T06:30:00Z', branch='HEAD'),
                                        user('u2', '2026-10-16T06:31:00Z', branch='feat/x', version='2.1.276')])
        self.assertEqual(r['branches'], {'feat/x': 1})
        self.assertEqual(r['versions'], {'2.1.301': 1, '2.1.276': 1})

    def test_malformed_entries_are_skipped_and_counted(self):
        def bad(mid, **kw):
            e = reply('b' + mid, '2026-10-16T06:30:06Z', mid)
            e['message'].update(kw)
            return e
        r = self.parse(SID + '.jsonl', [
            reply('a1', '2026-10-16T06:30:05Z', 'm1'),
            bad('m2', usage='oops'),
            bad('m3', content=7),
            bad('m4', usage={'input_tokens': '7', 'output_tokens': 1}),
            bad('m5', usage={'input_tokens': 1, 'cache_creation': 'x'}),
        ])
        self.assertEqual(r['models']['claude-opus-5']['calls'], 1)
        self.assertEqual(r['skipped'], 4)

    def test_prices_tolerate_odd_usage(self):
        import prices
        self.assertEqual(prices.cost_parts('x', 'claude-opus-5'), ({}, None))
        usd, _ = prices.cost({'input_tokens': '7', 'output_tokens': 1_000_000, 'cache_creation': 'x'}, 'claude-opus-5')
        self.assertAlmostEqual(usd, 25.0)

    def test_agent_folder_is_the_parent_dir_only(self):
        r = self.parse(os.path.join('subagents-notes', SID + '.jsonl'), [reply('a1', '2026-10-16T06:30:05Z', 'm1')])
        self.assertFalse(r['agentFile'])


class IndexTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ['SESSION_DASH_CLAUDE_DIR'] = self.tmp.name
        self.a = os.path.join(self.tmp.name, 'projects', '-home-me-STS-app', SID + '.jsonl')
        write(self.a, [user('u1', '2026-10-16T06:30:00Z'), reply('a1', '2026-10-16T06:30:05Z', 'm1')])

    def tearDown(self):
        self.tmp.cleanup()

    def index(self):
        with open(history.index_path()) as fh:
            return json.load(fh)

    def test_first_run_indexes_every_file(self):
        rep = history.run()
        self.assertEqual((rep['ok'], rep['files'], rep['changed'], rep['skipped']), (True, 1, 1, 0))
        j = self.index()
        self.assertEqual(j['v'], 1)
        self.assertRegex(j['tz'], r'^[+-]\d\d:\d\d$')
        self.assertEqual(j['sessions'][self.a]['models']['claude-opus-5']['calls'], 1)

    def test_unchanged_file_is_not_parsed_again(self):
        history.run()
        self.assertEqual(history.run()['changed'], 0)

    def test_grown_file_is_parsed_again(self):
        history.run()
        with open(self.a, 'a') as fh:
            fh.write(json.dumps(reply('a2', '2026-10-16T06:40:05Z', 'm2')) + '\n')
        os.utime(self.a, (time.time() + 5, time.time() + 5))
        self.assertEqual(history.run()['changed'], 1)
        self.assertEqual(self.index()['sessions'][self.a]['models']['claude-opus-5']['calls'], 2)

    def test_deleted_transcript_is_kept_as_pruned(self):
        history.run()
        os.remove(self.a)
        history.run()
        r = self.index()['sessions'][self.a]
        self.assertTrue(r['pruned'])
        self.assertEqual(r['models']['claude-opus-5']['calls'], 1)

    def test_old_version_or_broken_index_rebuilds(self):
        os.makedirs(os.path.dirname(history.index_path()), exist_ok=True)
        for text in ('{"v": 0, "sessions": {}}', '{broken'):
            with open(history.index_path(), 'w') as fh:
                fh.write(text)
            self.assertEqual(history.run()['changed'], 1)

    def test_one_bad_file_does_not_stop_the_run(self):
        bad = os.path.join(os.path.dirname(self.a), 'agent-bad.jsonl')
        write(bad, [reply('a1', '2026-10-16T06:30:05Z', 'm1', usage='not a dict')])
        rep = history.run()
        self.assertTrue(rep['ok'])
        self.assertEqual((rep['changed'], rep['skipped']), (2, 1))  # the file parses; its bad line is skipped

    def test_rebuild_reparses_everything(self):
        history.run()
        self.assertEqual(history.run(rebuild=True)['changed'], 1)

    def test_cli_prints_report_and_runs_isolated(self):
        out = subprocess.run([sys.executable, '-I', history.__file__, 'index'],
                             capture_output=True, text=True, env={**os.environ}, check=True).stdout
        self.assertTrue(json.loads(out)['ok'])

    def test_cli_rejects_unknown_mode(self):
        p = subprocess.run([sys.executable, '-I', history.__file__, 'nope'], capture_output=True, text=True)
        self.assertEqual(p.returncode, 2)

    def test_parse_failure_keeps_the_previous_rollup(self):
        history.run()
        with open(self.a, 'a') as fh:
            fh.write(json.dumps(reply('a2', '2026-10-16T06:40:05Z', 'm2')) + '\n')
        os.utime(self.a, (time.time() + 5, time.time() + 5))
        real = history.parse
        history.parse = lambda path: (_ for _ in ()).throw(RuntimeError('boom'))
        try: rep = history.run()
        finally: history.parse = real
        self.assertEqual((rep['changed'], rep['skipped']), (0, 1))
        self.assertEqual(self.index()['sessions'][self.a]['models']['claude-opus-5']['calls'], 1)

    def test_rebuild_keeps_pruned_rollups(self):
        history.run()
        os.remove(self.a)
        rep = history.run(rebuild=True)
        r = self.index()['sessions'][self.a]
        self.assertTrue(r['pruned'])
        self.assertEqual(r['models']['claude-opus-5']['calls'], 1)

    def test_unreadable_index_is_backed_up_first(self):
        os.makedirs(os.path.dirname(history.index_path()), exist_ok=True)
        with open(history.index_path(), 'w') as fh: fh.write('{broken')
        history.run()
        with open(history.index_path() + '.bak') as fh: self.assertEqual(fh.read(), '{broken')

    def test_other_version_is_backed_up_first(self):
        os.makedirs(os.path.dirname(history.index_path()), exist_ok=True)
        with open(history.index_path(), 'w') as fh: fh.write('{"v": 0, "sessions": {}}')
        history.run()
        self.assertTrue(os.path.exists(history.index_path() + '.bak'))

    def test_returning_transcript_is_no_longer_pruned(self):
        history.run()
        st = os.stat(self.a)
        saved = open(self.a).read()
        os.remove(self.a)
        history.run()
        self.assertTrue(self.index()['sessions'][self.a]['pruned'])
        with open(self.a, 'w') as fh: fh.write(saved)
        os.utime(self.a, (st.st_mtime, st.st_mtime))
        rep = history.run()
        self.assertEqual(rep['changed'], 0)
        self.assertFalse(self.index()['sessions'][self.a]['pruned'])


if __name__ == '__main__':
    unittest.main()
