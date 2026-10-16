import os, tempfile, unittest

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


if __name__ == '__main__':
    unittest.main()
