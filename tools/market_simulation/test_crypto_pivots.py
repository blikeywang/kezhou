import unittest
from crypto_flow import align, LAG
from crypto_pivots import HOUR, compare_points, price_pivots, pivot_comparisons

START = 1789000000000 // HOUR * HOUR


def sample(n=85):
    rows = []
    for i in range(n):
        rows.append({'time':START+(i+1)*HOUR,'open':120,'high':125,'low':118,'close':120,
                     'cvd':500+i, 'oi':10000+i*10, 'cvdAnchor':START})
    # A is a prominent lower price low. B occurs three days later and is higher,
    # but its CVD is LOWER. Several small intervening turns must not replace A.
    rows[5].update(low=90,cvd=100)
    rows[30].update(low=113,cvd=180)
    rows[60].update(low=116,cvd=200)
    rows[77].update(low=100,cvd=-50,oi=12000)
    return rows


class PivotEvidenceTests(unittest.TestCase):
    def test_user_case_matches_two_price_points_seventy_two_hours_apart(self):
        rows = sample()
        _, pairs = pivot_comparisons(rows)
        p = next(p for p in pairs if p['a']['index']==5 and p['b']['index']==77 and p['kind']=='low')
        self.assertEqual(p['signal'],'bullish_absorption')
        self.assertEqual(p['elapsedHours'],72)
        self.assertEqual(p['a']['price'],90)
        self.assertEqual(p['b']['price'],100)
        self.assertEqual(p['cvdChange'],-150)
        self.assertEqual(p['a']['oi'],10050)
        self.assertEqual(p['b']['oi'],12000)
        self.assertAlmostEqual(p['oiChangePct'],(12000/10050-1)*100)
        self.assertEqual(p['referenceRole'],'unbroken_structure')

    def test_unrelated_cvd_extreme_is_not_used_in_place_of_cvd_at_price_low(self):
        rows = sample()
        rows[70]['cvd']=-9999
        _, pairs=pivot_comparisons(rows)
        p=next(p for p in pairs if p['a']['index']==5 and p['b']['index']==77)
        self.assertEqual(p['a']['cvd'],100)
        self.assertEqual(p['b']['cvd'],-50)
        self.assertEqual(p['signal'],'bullish_absorption')

    def test_no_future_bars_are_used_to_claim_pivot_confirmation(self):
        rows=sample()
        _, short=pivot_comparisons(rows[:78])
        early=next(p for p in short if p['a']['index']==5 and p['b']['index']==77)
        self.assertEqual(early['status'],'pivot_pending')
        self.assertIsNone(early['b']['pivotConfirmedAt'])
        _, full=pivot_comparisons(rows)
        later=next(p for p in full if p['id']==early['id'])
        self.assertEqual(later['status'],'divergence')
        self.assertEqual(later['b']['pivotConfirmedAt'],rows[79]['time'])
        self.assertEqual(later['observedAt'],early['observedAt'])

    def test_comparison_is_invariant_to_shared_cvd_zero_point(self):
        rows=sample();a=rows[5]|{'price':90};b=rows[77]|{'price':100}
        base=compare_points(a,b,'low')
        shifted=compare_points(a|{'cvd':1100},b|{'cvd':950},'low')
        self.assertEqual(base,shifted)
        self.assertFalse(compare_points(a,b|{'cvdAnchor':START+HOUR},'low')['comparable'])

    def test_oi_is_sampled_at_each_pivot_and_need_not_be_bearish_to_detect_cvd(self):
        rows=sample();a=rows[5]|{'price':90};b=rows[77]|{'price':100}
        b['oi']=None
        result=compare_points(a,b,'low')
        self.assertEqual(result['signal'],'bullish_absorption')
        self.assertIsNone(result['oiChange'])

    def test_symmetric_highs_and_regular_divergences(self):
        a={'time':START,'price':100,'cvd':10,'cvdAnchor':START}
        b={'time':START+70*HOUR,'price':99,'cvd':20,'cvdAnchor':START}
        self.assertEqual(compare_points(a,b,'high')['signal'],'bearish_absorption')
        self.assertEqual(compare_points(a,b,'low')['signal'],'bullish_exhaustion')
        self.assertEqual(compare_points(a,b|{'price':101,'cvd':0},'high')['signal'],'bearish_exhaustion')

    def test_hourly_alignment_preserves_old_segment_but_does_not_bridge_a_gap(self):
        f=[];c=[];o=[]
        for i in range(100):
            t=START+i*HOUR
            f.append([t,3,5]);c.append([t,100,102,99,101,10,8,800,'1']);o.append([t+HOUR,1000,i+100,10000])
        f.pop(50)
        rows,_=align(f,c,o,START+100*HOUR+LAG,True,step=HOUR,history_ms=30*24*HOUR,keep_segments=True)
        self.assertEqual(len(rows),99)
        self.assertEqual(rows[0]['cvdAnchor'],START)
        self.assertEqual(rows[-1]['cvdAnchor'],START+51*HOUR)
        self.assertEqual(rows[0]['oi'],100)
        self.assertEqual(rows[-1]['oi'],199)
        self.assertEqual(rows[-1]['cvd'],98)
        rows[40]['low']=90;rows[90]['low']=100
        self.assertFalse(any(p['a']['index']==40 and p['b']['index']==90 for p in pivot_comparisons(rows)[1]))

    def test_later_break_of_B_price_marks_that_pattern_invalid_without_moving_A(self):
        rows=sample();rows[-1]['low']=98
        _,pairs=pivot_comparisons(rows)
        event=next(p for p in pairs if p['a']['index']==5 and p['b']['index']==77)
        self.assertEqual(event['status'],'invalidated')
        self.assertEqual(event['a']['price'],90)
        self.assertEqual(event['b']['price'],100)


if __name__=='__main__': unittest.main()
