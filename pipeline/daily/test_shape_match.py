"""Known-path retrieval, timing, source fidelity and score isolation."""
import copy
import math
import unittest
import numpy as np
from shape_match import (build_shape_matches, confirmed_pivots, pivot_signature,
                         pivot_distance, normalized, elastic_distance, return_features)


def rows(n=520):
    return [[1609459200+i*86400,None,None,None,
             float(100*math.exp(.16*math.sin(i/13)+.08*math.sin(i/4.7)+.0003*i)),None]
            for i in range(n)]


class ShapeTests(unittest.TestCase):
    def build(self, source=None, **kw):
        return build_shape_matches(source or rows(),60,30,group='crypto',**kw)

    def test_original_source_and_no_future_overlap(self):
        source=rows(); result=self.build(source)
        original={r[0]:r for r in source}
        for cases in result['cases'].values():
            self.assertTrue(cases)
            for c in cases:
                self.assertLess(c['bars'][-1][0],source[-60][0])
                self.assertEqual(c['end']-c['start']+1,c['window'])
                self.assertEqual(c['bars'][c['end']+30][0],c['bars'][-1][0])
                self.assertTrue(all(r==original[r[0]] for r in c['bars']))
                self.assertTrue(all(r[1:4]==[None,None,None] and r[5] is None for r in c['bars']))
                for pivot in c['pivots']:
                    self.assertLess(pivot['confirmedAt'],c['window'])
                    self.assertEqual(pivot['price'],c['bars'][c['start']+pivot['index']][4])

    def test_scores_finite_bounded_and_separate(self):
        result=self.build()
        for method,cases in result['cases'].items():
            for c in cases:
                self.assertEqual(c['score'],c['scores'][method])
                self.assertTrue(all(x is None or 0<=x<=100 for x in c['scores'].values()))
        self.assertFalse(result['limits']['scoreIsProbability'])
        self.assertFalse(result['limits']['namedPatternClassifier'])

    def test_selected_windows_do_not_overlap(self):
        for cases in self.build()['cases'].values():
            for i,a in enumerate(cases):
                for b in cases[i+1:]:
                    self.assertTrue(a['endTime']<b['startTime'] or b['endTime']<a['startTime'])

    def test_variable_durations_and_independent_search(self):
        result=self.build()
        self.assertEqual(set(result['limits']['eligibleByLength']),{'45','60','75','90'})
        self.assertGreater(result['limits']['scoredCandidates'],48)
        self.assertTrue(any(c['window']!=60 for cases in result['cases'].values() for c in cases))

    def test_invalid_prices_timestamps_rejected(self):
        for value in (0,-1,float('nan'),float('inf')):
            source=rows();source[4][4]=value
            with self.assertRaises(ValueError): self.build(source)
        source=rows();source[5][0]=source[4][0]
        with self.assertRaises(ValueError):self.build(source)

    def test_gaps_in_current_rejected_historical_excluded(self):
        source=rows();del source[-5]
        with self.assertRaisesRegex(ValueError,'gap'):self.build(source)
        source=rows(); missing=source[210][0];del source[210]
        for cases in self.build(source)['cases'].values():
            for c in cases:self.assertFalse(c['startTime']<missing<=c['bars'][-1][0])

    def test_pivots_only_confirmed_after_reversal(self):
        price=np.exp(np.array([0,.2,.4,.3,.1,.3,.5,.7]))
        pivots=confirmed_pivots(price)
        self.assertTrue(any(p['type']=='high' and p['index']==2 for p in pivots))
        self.assertFalse(any(p['index']==7 for p in pivots))
        self.assertTrue(all(p['confirmedAt']>p['index'] for p in pivots))
        self.assertEqual(confirmed_pivots([100]*30),[])
        self.assertIsNone(pivot_signature([100,101,102,103])[1])

    def test_pivot_order_and_identity(self):
        a=np.exp(np.array([0,.4,.1,.4,.15,.8,.25,.5]))
        sig=pivot_signature(a)[1]
        self.assertEqual(pivot_distance(sig,sig),0)
        self.assertGreater(pivot_distance(sig,pivot_signature(a[::-1])[1]),0)

    def test_path_identity_and_price_unit_invariance(self):
        a=np.array([100,120,110,125,105,150,115,130],float)
        self.assertTrue(np.allclose(normalized(np.log(a)),normalized(np.log(a*100))))
        z=normalized(np.log(a));self.assertEqual(elastic_distance(z,z),0)
        self.assertTrue(np.allclose(return_features(z),return_features(z*2+5)))

    def test_no_candidates_is_empty_not_fabricated(self):
        result=self.build(rows(75))
        self.assertTrue(all(not cases for cases in result['cases'].values()))

    def test_future_outcomes_not_used_in_scoring(self):
        # Validate direct recomputation from matching slices, not their visible
        # forward rows. Changing any displayed future cannot affect these scores.
        from shape_match import sampled, _score
        source=rows(); result=self.build(source)
        ref=normalized(sampled(np.log([r[4] for r in source[-60:]])))
        for cases in result['cases'].values():
            for c in cases:
                prices=[r[4] for r in c['bars'][c['start']:c['end']+1]]
                p=normalized(sampled(np.log(prices)))
                self.assertAlmostEqual(c['scores']['elastic'],_score(elastic_distance(ref,p)),places=4)
                self.assertAlmostEqual(c['scores']['returns'],_score(float(np.linalg.norm(return_features(p)-return_features(ref))/np.sqrt(3))),places=4)


if __name__=='__main__':unittest.main()
