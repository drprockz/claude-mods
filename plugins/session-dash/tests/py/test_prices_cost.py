import json, os, subprocess, sys, tempfile, unittest

BIN = os.path.join(os.path.dirname(__file__), '..', '..', 'bin')
sys.path.insert(0, os.path.abspath(BIN))


def line(**kw):
    return json.dumps(kw) + '\n'


class PricesTest(unittest.TestCase):
    def test_opus_4_5_is_priced(self):
        import prices
        usd, miss = prices.cost({'input_tokens': 1_000_000}, 'claude-opus-4-5-20251101')
        self.assertIsNone(miss)
        self.assertAlmostEqual(usd, 5.0)

    def test_parts_add_up_to_cost(self):
        import prices
        u = {'input_tokens': 1000, 'output_tokens': 2000, 'cache_read_input_tokens': 300_000,
             'cache_creation_input_tokens': 40_000}
        parts, miss = prices.cost_parts(u, 'claude-opus-5')
        usd, _ = prices.cost(u, 'claude-opus-5')
        self.assertIsNone(miss)
        self.assertEqual(set(parts), {'in', 'out', 'cr', 'cw'})
        self.assertAlmostEqual(sum(parts.values()), usd)
        self.assertAlmostEqual(parts['cr'], 300_000 * 0.50 / 1e6)

    def test_unpriced_model(self):
        import prices
        self.assertEqual(prices.cost({'input_tokens': 5}, 'claude-mystery-1'), (0.0, 'claude-mystery-1'))


class CostScriptTest(unittest.TestCase):
    def test_session_total_unchanged_and_runs_isolated(self):
        with tempfile.TemporaryDirectory() as d:
            base = os.path.join(d, 's1')
            with open(base + '.jsonl', 'w') as fh:
                usage = {'input_tokens': 1000, 'output_tokens': 1000}
                fh.write(line(type='assistant', requestId='r1', timestamp='2026-10-16T06:00:00Z',
                              message={'id': 'm1', 'model': 'claude-opus-5', 'usage': usage}))
                fh.write(line(type='assistant', requestId='r1', timestamp='2026-10-16T06:00:01Z',
                              message={'id': 'm1', 'model': 'claude-opus-5', 'usage': usage}))
            # -I as the status line runs it: cost.py must find prices.py on its own
            out = subprocess.run([sys.executable, '-I', os.path.join(BIN, 'cost.py'), 'session', base],
                                 capture_output=True, text=True, check=True).stdout
            j = json.loads(out)
            self.assertEqual(j['requests'], 1)
            self.assertAlmostEqual(j['usd'], 0.03)  # 1000 in × $5 + 1000 out × $25 per MTok


if __name__ == '__main__':
    unittest.main()
