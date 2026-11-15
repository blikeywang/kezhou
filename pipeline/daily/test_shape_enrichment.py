import copy
import unittest
from test_cycles import history, stamp
import cycles
from enrich_shape_history import enrich

class EnrichmentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.meta={'grp':'crypto','ticker':'BTCUSDT'}
        cls.history=history()
        cls.now=stamp('2026-11-05T09:00:00')
        cls.snapshot=cycles.build_profile('BTC',cls.meta,cls.history,'1d-6m',cycles.configurations('crypto')['1d-6m'],cls.now)

    def test_only_supplement_changes(self):
        before=copy.deepcopy(self.snapshot)
        result=enrich(self.snapshot,self.history,self.meta,self.now+86400)
        for k,v in before.items():
            if k not in ('shapeMatches','shapeGeneratedAt'):self.assertEqual(result[k],v)
        self.assertEqual(before,self.snapshot)
        self.assertEqual(result['asof'],before['asof'])

    def test_revised_source_fails_without_mutation(self):
        source=copy.deepcopy(self.history)
        source['bars'][-3][4]*=1.001
        before=copy.deepcopy(self.snapshot)
        with self.assertRaisesRegex(ValueError,'revised'):enrich(self.snapshot,source,self.meta,self.now)
        self.assertEqual(before,self.snapshot)

    def test_harmless_volume_sum_roundoff_is_not_a_price_revision(self):
        source=copy.deepcopy(self.history)
        source['bars'][-3][5] += 1e-10
        result=enrich(self.snapshot,source,self.meta,self.now)
        self.assertEqual(result['current'],self.snapshot['current'])

    def test_missing_recorded_date_fails(self):
        source=copy.deepcopy(self.history);source['bars'].pop()
        with self.assertRaisesRegex(ValueError,'asof'):enrich(self.snapshot,source,self.meta,self.now)

if __name__=='__main__':unittest.main()
